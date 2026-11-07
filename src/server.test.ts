import { mock, mockDeep, type DeepMockProxy } from "jest-mock-extended";
import { Context, Telegraf } from "telegraf";
import { schedule } from "node-cron";
import { startServer, type ServerRunner } from "./server.js";
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

jest.mock("./config.js", () => ({
  config: { options: { scheduling: { cron: "0 9 * * *" } } },
}));
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
  const task = mock<ReturnType<typeof schedule>>();
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
    jest.mocked(schedule).mockReturnValue(task);
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
    expect(runner.startRun).toHaveBeenCalledWith("manual");
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

  it("shuts down even when another abort listener stops immediate propagation", async () => {
    await startServer(serverRunner(), lifecycle.handlers);
    lifecycle.handlers.signal.addEventListener(
      "abort",
      (event) => event.stopImmediatePropagation(),
      { once: true },
    );

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
      expect(shutdownTelegramBot).not.toHaveBeenCalled();
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

      expect(schedule).not.toHaveBeenCalled();
      expect(launchTelegramBot).not.toHaveBeenCalled();
      expect(shutdownTelegramBot).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      process.exitCode = previousExitCode;
    }
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
    const callback = jest.mocked(schedule).mock.calls[0][1];
    if (typeof callback !== "function")
      throw new Error("Expected cron callback");
    await callback(mock<Parameters<typeof callback>[0]>());
    expect(runner.startRun).toHaveBeenCalledWith("scheduled");
  });

  it("logs scheduled run failures and clears tracking before shutdown", async () => {
    let rejectRun!: (error: Error) => void;
    const finished = new Promise<RunStatus>((_resolve, reject) => {
      rejectRun = reject;
    });
    runner.startRun.mockResolvedValue({ started: true, finished });
    await startServer(serverRunner(), lifecycle.handlers);
    const callback = jest.mocked(schedule).mock.calls[0][1];
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
