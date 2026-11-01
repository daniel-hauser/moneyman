import { mock, mockDeep, type DeepMockProxy } from "jest-mock-extended";
import { Context, Telegraf } from "telegraf";
import { schedule } from "node-cron";
import { startServer, type ServerRunner } from "./server.js";
import { accountId } from "./utils/accountLabel.js";
import type { RunStatus } from "./types.js";
import { getEventListeners } from "node:events";
import { logToPublicLog } from "./utils/logger.js";
import { registerCommands } from "./bot/commands.js";
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
jest.mock("node-cron", () => ({ schedule: jest.fn() }));
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

describe("startServer", () => {
  let runner: ReturnType<typeof mock<Required<ServerRunner>>>;
  let exit: jest.SpyInstance;
  let listeners: Map<
    "SIGINT" | "SIGTERM",
    ReturnType<typeof process.listeners>
  >;
  const task = mock<ReturnType<typeof schedule>>();
  let bot: DeepMockProxy<Telegraf<Context>>;
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const handlers = () => jest.mocked(registerCommands).mock.calls[0][1];

  beforeEach(() => {
    jest.clearAllMocks();
    listeners = new Map(
      (["SIGINT", "SIGTERM"] as const).map((signal) => [
        signal,
        process.listeners(signal),
      ]),
    );
    exit = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    runner = mock<Required<ServerRunner>>();
    jest.mocked(schedule).mockReturnValue(task);
    bot = mockDeep<Telegraf<Context>>();
    bot.telegram.deleteMyCommands.mockResolvedValue(true);
    jest.mocked(getTelegramBot).mockReturnValue(bot);
    jest.mocked(launchTelegramBot).mockResolvedValue(undefined);
  });

  afterEach(() => {
    for (const [signal, original] of listeners) {
      for (const listener of process.listeners(signal)) {
        if (!original.includes(listener))
          process.removeListener(signal, listener);
      }
    }
    jest.restoreAllMocks();
  });

  it("answers that a scrape is already in progress when the lock is held", async () => {
    runner.startRun.mockResolvedValue({
      started: false,
      finished: Promise.resolve(undefined),
    });

    await startServer(runner);

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
      await startServer(runner);
      await expect(handlers().refreshSecrets!()).resolves.toContain(message);
      expect(runner.refreshSecrets).toHaveBeenCalledTimes(1);
      expect(runner.startRun).not.toHaveBeenCalled();
    },
  );

  it("does not offer refresh when the runner has no provider capability", async () => {
    await startServer({ ...runner, refreshSecrets: undefined });
    expect(handlers().refreshSecrets).toBeUndefined();
  });

  it("acknowledges a started run without waiting for it and reports its failure", async () => {
    const error = new Error("boom");
    let rejectRun!: (e: unknown) => void;
    const finished = new Promise<RunStatus | undefined>((_resolve, reject) => {
      rejectRun = reject;
    });
    runner.startRun.mockResolvedValue({ started: true, finished });

    await startServer(runner);

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
      await startServer(runner);
      await handlers().scrape();

      process.emit(signal);
      await flush();
      expect(task.stop).toHaveBeenCalledTimes(1);
      expect(shutdownTelegramBot).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();

      releaseRun();
      await flush();
      expect(shutdownTelegramBot).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
      expect(exit).toHaveBeenCalledTimes(1);
      expect(
        getEventListeners(
          combined.mock.results[0].value as AbortSignal,
          "abort",
        ),
      ).toEqual([]);
      expect(logToPublicLog).not.toHaveBeenCalledWith(
        expect.stringContaining("did not finish"),
      );
    },
  );

  it("refuses new scrapes while shutting down", async () => {
    let releaseRun!: () => void;
    const finished = new Promise<RunStatus | undefined>((resolve) => {
      releaseRun = () => resolve(undefined);
    });
    runner.startRun.mockResolvedValue({ started: true, finished });
    await startServer(runner);
    await handlers().scrape();

    process.emit("SIGTERM");
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
        await startServer(runner);
        await handlers().scrape();

        process.emit("SIGTERM");
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
    await startServer(runner);
    const callback = jest.mocked(schedule).mock.calls[0][1];
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
      await startServer(runner);

      const choices = await handlers().listAccounts!();

      expect(choices).toEqual([
        { id: firstCard, label: "isracard · ••1111", failedLastRun: false },
        {
          id: accountId({
            companyId: "isracard",
            card6Digits: "222222",
          } as never),
          label: "isracard · ••2222",
          failedLastRun: false,
        },
        {
          id: accountId({
            companyId: "hapoalim",
            userCode: "bankuser",
          } as never),
          label: "hapoalim · ••user",
          failedLastRun: false,
        },
        // Kept apart by the field the first one does not have, and deduped
        // against the identical fourth-card entry
        {
          id: accountId({
            companyId: "isracard",
            card6Digits: "111111",
            username: "noam",
          } as never),
          label: "isracard · ••1111",
          failedLastRun: false,
        },
      ]);
      expect(new Set(choices.map(({ id }) => id)).size).toBe(choices.length);
    });

    it("scrapes the account that shares the first login field with another one", async () => {
      // The picker must be able to select it on its own, not scrape both
      runner.startRun.mockResolvedValue({
        started: true,
        finished: Promise.resolve(undefined),
      });
      await startServer(runner);
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

      await startServer(runner);

      const choices = await handlers().listAccounts!();
      expect(choices.filter(({ failedLastRun }) => failedLastRun)).toEqual([
        { id: firstCard, label: "isracard · ••1111", failedLastRun: true },
      ]);
    });

    it("scrapes only the selected account", async () => {
      runner.startRun.mockResolvedValue({
        started: true,
        finished: Promise.resolve(undefined),
      });
      await startServer(runner);

      await expect(handlers().scrape([firstCard])).resolves.toContain(
        "Scrape started",
      );

      expect(runner.startRun).toHaveBeenCalledWith("manual", {
        accountIds: [firstCard],
      });
    });

    it("starts no run for a selection that is no longer configured", async () => {
      await startServer(runner);

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
    await startServer(runner);
    const callback = jest.mocked(schedule).mock.calls[0][1];
    if (typeof callback !== "function")
      throw new Error("Expected cron callback");
    await callback(mock<Parameters<typeof callback>[0]>());
    await flush();

    const error = new Error("Scheduled scrape failed");
    rejectRun(error);
    await flush();

    expect(mockLogger).toHaveBeenCalledWith("scheduled run failed", error);
    process.emit("SIGTERM");
    await flush();
    expect(shutdownTelegramBot).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
