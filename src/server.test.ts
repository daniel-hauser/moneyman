import { mock, mockDeep, type DeepMockProxy } from "jest-mock-extended";
import { Context, Telegraf } from "telegraf";
import { createTask } from "node-cron";
import { startServer, type ServerRunner } from "./server.js";
import { accountId } from "./utils/accountLabel.js";
import type { RunStatus } from "./types.js";
import { EventEmitter, getEventListeners } from "node:events";
import type { ProcessEventMap } from "node:process";
import { logToPublicLog } from "./utils/logger.js";
import { registerCommands } from "./bot/commands.js";
import { registerProcessHandlers } from "./utils/processErrors.js";
import {
  getTelegramBot,
  launchTelegramBot,
  shutdownTelegramBot,
  sendError,
} from "./bot/notifier.js";

jest.mock("./config.js", () => {
  const accounts = [
    { companyId: "isracard", card6Digits: "111111", password: "first-card" },
    { companyId: "isracard", card6Digits: "222222", password: "second-card" },
    { companyId: "hapoalim", userCode: "bankuser", password: "bank" },
    // Same non-secret fields as the first card: selected together, never apart
    { companyId: "isracard", card6Digits: "111111", password: "third-card" },
    // Shares the first login field with that card, but differs in another one:
    // must stay its own button instead of collapsing into it
    {
      companyId: "isracard",
      card6Digits: "111111",
      username: "noam",
      password: "fourth-card",
    },
  ];
  return {
    config: { accounts, options: { scheduling: { cron: "0 9 * * *" } } },
    getAccounts: jest.fn(() => accounts),
  };
});
jest.mock("node-cron", () => ({ createTask: jest.fn() }));
jest.mock("./bot/commands.js", () => ({ registerCommands: jest.fn() }));
jest.mock("./bot/notifier.js", () => ({
  getTelegramBot: jest.fn(),
  launchTelegramBot: jest.fn(),
  shutdownTelegramBot: jest.fn().mockResolvedValue(undefined),
  sendError: jest.fn().mockResolvedValue(undefined),
}));
const mockLogger = jest.fn();
jest.mock("./utils/logger.js", () => ({
  createLogger:
    () =>
    (...args: unknown[]) =>
      mockLogger(...args),
  logToPublicLog: jest.fn(),
}));

function createProcessHandlers() {
  const source = new EventEmitter<ProcessEventMap>();
  const notify = jest
    .fn<Promise<unknown>, [string]>()
    .mockResolvedValue(undefined);
  const onFatal = jest.fn<void, [unknown]>();
  const handlers = registerProcessHandlers({
    logger: () => {},
    notify,
    onFatal,
    process: source,
  });

  return { source, notify, onFatal, handlers };
}

describe("startServer", () => {
  let runner: ReturnType<typeof mock<Required<ServerRunner>>>;
  let exit: jest.SpyInstance;
  const task = mock<ReturnType<typeof createTask>>();
  let lifecycle: ReturnType<typeof createProcessHandlers>;
  let bot: DeepMockProxy<Telegraf<Context>>;
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const handlers = () => jest.mocked(registerCommands).mock.calls[0][1];
  const serverRunner = (): ServerRunner => ({
    startRun: runner.startRun,
    refreshSecrets: runner.refreshSecrets,
    isRunning: runner.isRunning,
    getLastRun: runner.getLastRun,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    exit = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    lifecycle = createProcessHandlers();
    runner = mock<Required<ServerRunner>>();
    jest.mocked(createTask).mockReturnValue(task);
    bot = mockDeep<Telegraf<Context>>();
    bot.telegram.deleteMyCommands.mockResolvedValue(true);
    jest.mocked(getTelegramBot).mockReturnValue(bot);
    jest.mocked(launchTelegramBot).mockResolvedValue(undefined);
  });

  afterEach(() => {
    lifecycle.handlers.dispose();
    jest.restoreAllMocks();
  });

  it("answers that a scrape is already in progress when the lock is held", async () => {
    runner.startRun.mockResolvedValue({
      started: false,
      finished: Promise.resolve(undefined),
    });

    await startServer(serverRunner(), lifecycle.handlers);

    await expect(handlers().scrape()).resolves.toContain(
      "A scrape is already in progress",
    );
    expect(runner.startRun).toHaveBeenCalledWith("manual", {});
    expect(sendError).not.toHaveBeenCalled();
  });

  it.each([
    ["refreshed", "Secrets fetched and validated"],
    ["failed", "Secret refresh failed"],
  ] as const)(
    "replies truthfully to a %s refresh without starting a scrape",
    async (result, message) => {
      runner.refreshSecrets.mockResolvedValue(result);
      await startServer(serverRunner(), lifecycle.handlers);
      await expect(handlers().refreshSecrets!()).resolves.toContain(message);
      expect(runner.refreshSecrets).toHaveBeenCalledTimes(1);
      expect(runner.startRun).not.toHaveBeenCalled();
    },
  );

  it("does not offer refresh when the runner has no provider capability", async () => {
    await startServer(
      { ...serverRunner(), refreshSecrets: undefined },
      lifecycle.handlers,
    );
    expect(handlers().refreshSecrets).toBeUndefined();
  });

  it("acknowledges a started run without waiting for it and reports its failure", async () => {
    const error = new Error("boom");
    let rejectRun!: (e: unknown) => void;
    const finished = new Promise<RunStatus | undefined>((_resolve, reject) => {
      rejectRun = reject;
    });
    runner.startRun.mockResolvedValue({ started: true, finished });

    await startServer(serverRunner(), lifecycle.handlers);

    await expect(handlers().scrape()).resolves.toContain("Scrape started");

    rejectRun(error);
    await flush();
    expect(sendError).toHaveBeenCalledWith(error, "Manual scrape");
    expect(runner.isRunning).not.toHaveBeenCalled();
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "waits for the run in progress on %s before exiting",
    async (signal) => {
      const combined = jest.spyOn(AbortSignal, "any");
      let releaseRun!: () => void;
      const finished = new Promise<RunStatus | undefined>((resolve) => {
        releaseRun = () => resolve(undefined);
      });
      runner.startRun.mockResolvedValue({ started: true, finished });
      await startServer(serverRunner(), lifecycle.handlers);
      await handlers().scrape();

      lifecycle.source.emit(signal, signal);
      await flush();
      expect(task.stop).toHaveBeenCalledTimes(1);
      expect(shutdownTelegramBot).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      const runDrainSignal = combined.mock.results.at(-1)?.value as AbortSignal;
      expect(getEventListeners(runDrainSignal, "abort")).toHaveLength(1);

      releaseRun();
      await flush();
      expect(shutdownTelegramBot).toHaveBeenCalledTimes(1);
      expect(shutdownTelegramBot).toHaveBeenCalledWith();
      expect(exit).toHaveBeenCalledWith(0);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(getEventListeners(runDrainSignal, "abort")).toEqual([]);
      expect(logToPublicLog).not.toHaveBeenCalledWith(
        expect.stringContaining("did not finish"),
      );
    },
  );

  it("shuts down even when another abort listener stops immediate propagation", async () => {
    lifecycle.handlers.signal.addEventListener(
      "abort",
      (event) => event.stopImmediatePropagation(),
      { once: true },
    );
    await startServer(serverRunner(), lifecycle.handlers);

    lifecycle.source.emit("SIGTERM", "SIGTERM");
    await flush();

    expect(task.stop).toHaveBeenCalledTimes(1);
    expect(shutdownTelegramBot).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("refuses new scrapes while shutting down", async () => {
    let releaseRun!: () => void;
    const finished = new Promise<RunStatus | undefined>((resolve) => {
      releaseRun = () => resolve(undefined);
    });
    runner.startRun.mockResolvedValue({ started: true, finished });
    await startServer(serverRunner(), lifecycle.handlers);
    await handlers().scrape();

    lifecycle.source.emit("SIGTERM", "SIGTERM");
    await flush();

    await expect(handlers().scrape()).resolves.toContain("Shutting down");
    await expect(handlers().refreshSecrets!()).resolves.toContain(
      "Shutting down",
    );
    expect(runner.refreshSecrets).not.toHaveBeenCalled();
    expect(runner.startRun).toHaveBeenCalledTimes(1);

    releaseRun();
    await flush();
  });

  it.each([false, true])(
    "honors the drain timeout, including an expired deadline (%s)",
    async (alreadyAborted) => {
      const controller = new AbortController();
      if (alreadyAborted) controller.abort();
      const timeout = jest
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(controller.signal);
      try {
        runner.startRun.mockResolvedValue({
          started: true,
          finished: new Promise(() => {}),
        });
        await startServer(serverRunner(), lifecycle.handlers);
        await handlers().scrape();

        lifecycle.source.emit("SIGTERM", "SIGTERM");
        expect(timeout).toHaveBeenCalledWith(30_000);
        expect(exit).not.toHaveBeenCalled();
        controller.abort();
        await flush();

        expect(shutdownTelegramBot).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
        expect(logToPublicLog).toHaveBeenCalledWith(
          "The scrape did not finish within 30 seconds, shutting down anyway",
        );
      } finally {
        timeout.mockRestore();
      }
    },
  );

  it("drains fatal notifications before shutdown and preserves the failure exit code", async () => {
    const previousExitCode = process.exitCode;
    let releaseNotification!: () => void;
    lifecycle.notify.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseNotification = resolve;
      }),
    );
    lifecycle.onFatal.mockImplementation(() => {
      process.exitCode = 1;
    });

    try {
      await startServer(serverRunner(), lifecycle.handlers);
      lifecycle.source.emit(
        "uncaughtException",
        new Error("fatal error"),
        "uncaughtException",
      );
      await flush();

      expect(task.stop).toHaveBeenCalledTimes(1);
      expect(lifecycle.notify).toHaveBeenCalledTimes(1);
      expect(shutdownTelegramBot).toHaveBeenCalledTimes(1);
      expect(exit).not.toHaveBeenCalled();

      releaseNotification();
      await flush();

      expect(shutdownTelegramBot).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("skips startup and shuts down when the process signal is already aborted", async () => {
    const previousExitCode = process.exitCode;
    lifecycle.onFatal.mockImplementation(() => {
      process.exitCode = 1;
    });
    lifecycle.source.emit(
      "uncaughtException",
      new Error("fatal error"),
      "uncaughtException",
    );

    try {
      await startServer(serverRunner(), lifecycle.handlers);
      await flush();

      expect(createTask).toHaveBeenCalledTimes(1);
      expect(task.start).not.toHaveBeenCalled();
      expect(launchTelegramBot).not.toHaveBeenCalled();
      expect(shutdownTelegramBot).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("does not initialize Telegram if interrupted while the cron task starts", async () => {
    let releaseStart!: () => void;
    task.start.mockReturnValue(
      new Promise<void>((resolve) => {
        releaseStart = resolve;
      }),
    );

    const startup = startServer(serverRunner(), lifecycle.handlers);
    expect(task.start).toHaveBeenCalledTimes(1);

    lifecycle.source.emit("SIGTERM", "SIGTERM");
    await flush();
    expect(task.stop).toHaveBeenCalledTimes(1);
    expect(launchTelegramBot).not.toHaveBeenCalled();

    releaseStart();
    await startup;
    expect(launchTelegramBot).not.toHaveBeenCalled();
  });

  it("propagates cron task startup failures", async () => {
    const error = new Error("Cron task failed to start");
    task.start.mockRejectedValueOnce(error);

    await expect(startServer(serverRunner(), lifecycle.handlers)).rejects.toBe(
      error,
    );
    expect(launchTelegramBot).not.toHaveBeenCalled();
  });

  it("does not mistake a cron startup failure for a concurrent abort", async () => {
    const error = new Error("Cron task failed while shutting down");
    task.start.mockRejectedValueOnce(error);

    const startup = startServer(serverRunner(), lifecycle.handlers);
    lifecycle.source.emit("SIGTERM", "SIGTERM");

    await expect(startup).rejects.toBe(error);
    expect(launchTelegramBot).not.toHaveBeenCalled();
  });

  it("logs shutdown failures and exits with a failure code", async () => {
    const previousExitCode = process.exitCode;
    const error = new Error("Telegram shutdown failed");
    jest.mocked(shutdownTelegramBot).mockRejectedValueOnce(error);

    try {
      await startServer(serverRunner(), lifecycle.handlers);
      lifecycle.source.emit("SIGTERM", "SIGTERM");
      await flush();

      expect(mockLogger).toHaveBeenCalledWith(
        "Failed to shut down cleanly",
        error,
      );
      expect(process.exitCode).toBe(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("runs scheduled scrapes", async () => {
    runner.startRun.mockResolvedValue({
      started: true,
      finished: Promise.resolve({
        trigger: "scheduled",
        startedAt: new Date(),
        endedAt: new Date(),
        failed: false,
      }),
    });
    await startServer(serverRunner(), lifecycle.handlers);
    expect(createTask).toHaveBeenCalledWith("0 9 * * *", expect.any(Function));
    expect(task.start).toHaveBeenCalledTimes(1);
    const callback = jest.mocked(createTask).mock.calls[0][1];
    if (typeof callback !== "function")
      throw new Error("Expected cron callback");
    await callback(mock<Parameters<typeof callback>[0]>());
    expect(runner.startRun).toHaveBeenCalledWith("scheduled", {});
  });

  describe("account picker", () => {
    const firstCard = accountId({
      companyId: "isracard",
      card6Digits: "111111",
    } as never);

    it("offers every configured account, masking the login field", async () => {
      await startServer(runner, lifecycle.handlers);

      const choices = await handlers().listAccounts!();

      expect(choices).toEqual([
        { id: firstCard, label: "isracard · •••111", failedLastRun: false },
        {
          id: accountId({
            companyId: "isracard",
            card6Digits: "222222",
          } as never),
          label: "isracard · •••222",
          failedLastRun: false,
        },
        {
          id: accountId({
            companyId: "hapoalim",
            userCode: "bankuser",
          } as never),
          label: "hapoalim · ••••user",
          failedLastRun: false,
        },
        // Kept apart by the field the first one does not have, and deduped
        // against the identical fourth-card entry. Its label shows both
        // fields, so the two buttons do not read alike.
        {
          id: accountId({
            companyId: "isracard",
            card6Digits: "111111",
            username: "noam",
          } as never),
          label: "isracard · •••111 · n•••",
          failedLastRun: false,
        },
      ]);
      expect(new Set(choices.map(({ id }) => id)).size).toBe(choices.length);
      expect(new Set(choices.map(({ label }) => label)).size).toBe(
        choices.length,
      );
    });

    it("scrapes the account that shares the first login field with another one", async () => {
      // The picker must be able to select it on its own, not scrape both
      runner.startRun.mockResolvedValue({
        started: true,
        finished: Promise.resolve(undefined),
      });
      await startServer(runner, lifecycle.handlers);
      const choice = (await handlers().listAccounts!()).at(-1)!;

      await handlers().scrape([choice.id]);

      expect(runner.startRun).toHaveBeenCalledWith("manual", {
        accountIds: [choice.id],
      });
    });

    it("marks the accounts that failed in the last run", async () => {
      runner.getLastRun.mockReturnValue({
        trigger: "manual",
        startedAt: new Date(),
        endedAt: new Date(),
        failed: true,
        failedAccountIds: [firstCard],
      });

      await startServer(runner, lifecycle.handlers);

      const choices = await handlers().listAccounts!();
      expect(choices.filter(({ failedLastRun }) => failedLastRun)).toEqual([
        { id: firstCard, label: "isracard · •••111", failedLastRun: true },
      ]);
    });

    it("scrapes only the selected account", async () => {
      runner.startRun.mockResolvedValue({
        started: true,
        finished: Promise.resolve(undefined),
      });
      await startServer(runner, lifecycle.handlers);

      await expect(handlers().scrape([firstCard])).resolves.toContain(
        "Scrape started",
      );

      expect(runner.startRun).toHaveBeenCalledWith("manual", {
        accountIds: [firstCard],
      });
    });

    it("starts no run for a selection that is no longer configured", async () => {
      await startServer(runner, lifecycle.handlers);

      await expect(handlers().scrape(["000000000000"])).resolves.toContain(
        "no longer configured",
      );

      expect(runner.startRun).not.toHaveBeenCalled();
    });
  });

  it("logs scheduled run failures and clears tracking before shutdown", async () => {
    let rejectRun!: (error: Error) => void;
    const finished = new Promise<RunStatus>((_resolve, reject) => {
      rejectRun = reject;
    });
    runner.startRun.mockResolvedValue({ started: true, finished });
    await startServer(serverRunner(), lifecycle.handlers);
    const callback = jest.mocked(createTask).mock.calls[0][1];
    if (typeof callback !== "function")
      throw new Error("Expected cron callback");
    await callback(mock<Parameters<typeof callback>[0]>());
    await flush();

    const error = new Error("Scheduled scrape failed");
    rejectRun(error);
    await flush();

    expect(mockLogger).toHaveBeenCalledWith("scheduled run failed", error);
    lifecycle.source.emit("SIGTERM", "SIGTERM");
    await flush();
    expect(shutdownTelegramBot).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
