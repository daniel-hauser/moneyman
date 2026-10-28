import { mock, mockDeep } from "jest-mock-extended";
import { Context, Telegraf } from "telegraf";
import { schedule } from "node-cron";
import { startServer, type ServerRunner } from "./server.js";
import { registerCommands } from "./bot/commands.js";
import {
  getTelegramBot,
  launchTelegramBot,
  stopTelegramBot,
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
  stopTelegramBot: jest.fn(),
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
    jest.mocked(getTelegramBot).mockReturnValue(mockDeep<Telegraf<Context>>());
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

  it("acknowledges requests without waiting and reports rejected runs", async () => {
    const error = new Error("A scrape is already in progress");
    runner.runOnce
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockRejectedValueOnce(error);
    await startServer(runner);
    const first = handlers().scrape();
    const second = handlers().scrape();
    await expect(first).resolves.toContain("Scrape requested");
    await expect(second).resolves.toContain("Scrape requested");
    await flush();
    expect(sendError).toHaveBeenCalledWith(error, "Manual scrape");
    expect(runner.isRunning).not.toHaveBeenCalled();
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "stops immediately on %s even with an active run",
    async (signal) => {
      runner.runOnce.mockImplementation(() => new Promise(() => {}));
      await startServer(runner);
      await handlers().scrape();
      process.emit(signal);
      expect(task.stop).toHaveBeenCalledTimes(1);
      expect(stopTelegramBot).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
      process.emit(signal === "SIGINT" ? "SIGTERM" : "SIGINT");
      expect(exit).toHaveBeenCalledTimes(1);
    },
  );

  it("runs scheduled scrapes", async () => {
    runner.runOnce.mockResolvedValue({
      trigger: "scheduled",
      startedAt: new Date(),
      endedAt: new Date(),
      failed: false,
    });
    await startServer(runner);
    const callback = jest.mocked(schedule).mock.calls[0][1];
    if (typeof callback !== "function")
      throw new Error("Expected cron callback");
    await callback(mock<Parameters<typeof callback>[0]>());
    expect(runner.runOnce).toHaveBeenCalledWith("scheduled");
  });
});
