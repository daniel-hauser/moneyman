import { mock, mockDeep, type DeepMockProxy } from "jest-mock-extended";
import { Context, Telegraf } from "telegraf";
import { schedule } from "node-cron";
import { startServer, type ServerRunner } from "./server.js";
import type { RunStatus } from "./types.js";
import { registerCommands } from "./bot/commands.js";
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
jest.mock("./utils/logger.js", () => ({
  createLogger: () => jest.fn(),
  logToPublicLog: jest.fn(),
}));

describe("startServer", () => {
  let runner: ReturnType<typeof mock<ServerRunner>>;
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
    runner = mock<ServerRunner>();
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
    expect(runner.startRun).toHaveBeenCalledWith("manual");
    expect(sendError).not.toHaveBeenCalled();
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
    expect(runner.startRun).toHaveBeenCalledTimes(1);

    releaseRun();
    await flush();
  });

  it("gives up waiting for the scrape after the drain timeout", async () => {
    jest.useFakeTimers();
    try {
      runner.startRun.mockResolvedValue({
        started: true,
        finished: new Promise(() => {}),
      });
      await startServer(runner);
      await handlers().scrape();

      process.emit("SIGTERM");
      await jest.advanceTimersByTimeAsync(30_000);

      expect(shutdownTelegramBot).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      jest.useRealTimers();
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
    await startServer(runner);
    const callback = jest.mocked(schedule).mock.calls[0][1];
    if (typeof callback !== "function")
      throw new Error("Expected cron callback");
    await callback(mock<Parameters<typeof callback>[0]>());
    expect(runner.startRun).toHaveBeenCalledWith("scheduled");
  });
});
