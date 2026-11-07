import { mockDeep } from "jest-mock-extended";
import { Context, Telegraf } from "telegraf";
import { createBot } from "./bot.js";
import { logToPublicLog } from "../utils/logger.js";
import { getEventListeners } from "node:events";

jest.mock("../utils/logger.js", () => ({
  createLogger: () => jest.fn(),
  logToPublicLog: jest.fn(),
}));

jest.mock("../config.js", () => ({
  config: { options: { notifications: {} } },
}));

describe("createBot", () => {
  const bot = mockDeep<Telegraf<Context>>();
  let controller: ReturnType<typeof createBot>;
  let polling: PromiseWithResolvers<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    polling = Promise.withResolvers<void>();
    bot.launch.mockImplementation((config, onLaunch) => {
      (typeof config === "function" ? config : onLaunch)?.();
      return polling.promise;
    });
    bot.stop.mockImplementation(() => polling.resolve());
    bot.telegram.deleteMyCommands.mockResolvedValue(true);
    controller = createBot(bot);
  });

  afterEach(() => jest.restoreAllMocks());

  it("stops polling and clears the command menu", async () => {
    await controller.startTelegramBot();
    await controller.shutdownTelegramBot();

    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(bot.telegram.deleteMyCommands).toHaveBeenCalledWith();
  });

  it("logs menu cleanup failures without rejecting shutdown", async () => {
    bot.telegram.deleteMyCommands.mockRejectedValueOnce(
      new Error("Telegram unavailable"),
    );

    await expect(controller.shutdownTelegramBot()).resolves.toBeUndefined();
    expect(logToPublicLog).toHaveBeenCalledWith(
      "Failed to clear Telegram command menu",
      expect.any(Function),
    );
  });

  it.each([false, true])(
    "logs menu cleanup timeouts, including an expired deadline (%s)",
    async (alreadyAborted) => {
      const abort = new AbortController();
      if (alreadyAborted) abort.abort(new Error("menu timeout"));
      const timeout = jest
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(abort.signal);
      bot.telegram.deleteMyCommands.mockImplementationOnce(
        () => new Promise(() => {}),
      );

      const shutdown = controller.shutdownTelegramBot();
      expect(timeout).toHaveBeenCalledWith(3_000);
      abort.abort();
      await expect(shutdown).resolves.toBeUndefined();
      expect(logToPublicLog).toHaveBeenCalledWith(
        "Failed to clear Telegram command menu",
        expect.any(Function),
      );
    },
  );

  it("releases the deadline wait when menu cleanup completes first", async () => {
    const timeout = new AbortController();
    jest.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const combined = jest.spyOn(AbortSignal, "any");
    await controller.shutdownTelegramBot();
    expect(
      getEventListeners(combined.mock.results[0].value as AbortSignal, "abort"),
    ).toEqual([]);
    timeout.abort(new Error("late timeout"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logToPublicLog).not.toHaveBeenCalled();
  });

  it("bounds polling shutdown and menu cleanup under the same deadline", async () => {
    const timeout = new AbortController();
    jest.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    await controller.startTelegramBot();
    bot.stop.mockImplementation(() => {});
    bot.telegram.deleteMyCommands.mockImplementation(
      () => new Promise(() => {}),
    );

    const shutdown = controller.shutdownTelegramBot();
    timeout.abort(new Error("shutdown deadline"));
    await expect(shutdown).resolves.toBeUndefined();

    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(logToPublicLog).toHaveBeenCalledWith(
      "Failed to clear Telegram command menu",
      expect.any(Function),
    );
  });

  it("handles a command RPC rejection after the deadline already won", async () => {
    const timeout = new AbortController();
    const deletion = Promise.withResolvers<true>();
    jest.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    bot.telegram.deleteMyCommands.mockReturnValueOnce(deletion.promise);
    const shutdown = controller.shutdownTelegramBot();
    timeout.abort(new Error("menu timeout"));
    await shutdown;
    deletion.reject(new Error("late Telegram RPC failure"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logToPublicLog).toHaveBeenCalledTimes(1);
  });

  it("starts polling only once", async () => {
    await controller.startTelegramBot();
    await controller.startTelegramBot();

    expect(bot.launch).toHaveBeenCalledTimes(1);
    await controller.stopTelegramBot();
  });

  it("shares an in-flight polling startup between callers", async () => {
    let onLaunch!: () => void;
    bot.launch.mockImplementationOnce((config, callback) => {
      onLaunch = typeof config === "function" ? config : callback!;
      return polling.promise;
    });

    const first = controller.startTelegramBot();
    const second = controller.startTelegramBot();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(bot.launch).toHaveBeenCalledTimes(1);

    onLaunch();
    await Promise.all([first, second]);
    await controller.stopTelegramBot();
    expect(bot.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps the server launch promise pending until polling stops", async () => {
    const launch = controller.launchTelegramBot();
    await controller.startTelegramBot();
    const state = await Promise.race([
      launch.then(() => "resolved"),
      Promise.resolve("pending"),
    ]);

    expect(state).toBe("pending");
    await controller.stopTelegramBot();
    await expect(launch).resolves.toBeUndefined();
  });

  it("shares the in-flight shutdown with concurrent callers", async () => {
    const deletion = Promise.withResolvers<true>();
    bot.telegram.deleteMyCommands.mockReturnValueOnce(deletion.promise);

    const first = controller.shutdownTelegramBot();
    const second = controller.shutdownTelegramBot();

    expect(second).toBe(first);
    expect(bot.telegram.deleteMyCommands).toHaveBeenCalledTimes(1);
    deletion.resolve(true);
    await Promise.all([first, second]);
  });

  it("permits a retry after polling startup fails", async () => {
    bot.launch.mockRejectedValueOnce(new Error("polling failed"));

    await expect(controller.startTelegramBot()).rejects.toThrow(
      "polling failed",
    );

    await controller.startTelegramBot();

    expect(bot.launch).toHaveBeenCalledTimes(2);
    await controller.stopTelegramBot();
  });

  it("stops polling only when running", async () => {
    controller.stopTelegramBot();
    expect(bot.stop).not.toHaveBeenCalled();

    await controller.startTelegramBot();
    await controller.stopTelegramBot();
    await controller.stopTelegramBot();

    expect(bot.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps shutting down when Telegraf has nothing to stop yet", async () => {
    await controller.startTelegramBot();
    bot.stop.mockImplementationOnce(() => {
      throw new Error("Bot is not running!");
    });

    await controller.stopTelegramBot();
  });

  it("retries stop when shutdown races with Telegraf polling startup", async () => {
    let onLaunch!: () => void;
    let pollingReady = false;
    bot.launch.mockImplementationOnce((config, callback) => {
      onLaunch = typeof config === "function" ? config : callback!;
      return polling.promise;
    });
    bot.stop.mockImplementation(() => {
      if (!pollingReady) throw new Error("Bot is not running!");
      polling.resolve();
    });

    const startup = controller.startTelegramBot();
    const shutdown = controller.stopTelegramBot();
    onLaunch();
    pollingReady = true;

    await Promise.all([startup, shutdown]);
    expect(bot.stop).toHaveBeenCalledTimes(2);
  });

  it("rejects startup when Telegram is not configured", async () => {
    const unconfigured = createBot(null);

    await expect(unconfigured.startTelegramBot()).rejects.toThrow(
      "Telegram is not configured",
    );
    await unconfigured.stopTelegramBot();
    await expect(unconfigured.shutdownTelegramBot()).resolves.toBeUndefined();
  });
});
