import { mockDeep } from "jest-mock-extended";
import { Context, Telegraf } from "telegraf";
import { createBot } from "./bot.js";
import { logToPublicLog } from "../utils/logger.js";

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

  beforeEach(() => {
    jest.clearAllMocks();
    bot.launch.mockResolvedValue(undefined);
    bot.telegram.deleteMyCommands.mockResolvedValue(true);
    controller = createBot(bot);
  });

  afterEach(() => jest.restoreAllMocks());

  it("stops polling and clears the command menu", async () => {
    await controller.launchTelegramBot();
    await controller.shutdownTelegramBot();

    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(bot.telegram.deleteMyCommands).toHaveBeenCalledWith();
    expect(controller.isTelegramBotRunning()).toBe(false);
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

  it("bounds menu cleanup to three seconds", async () => {
    const abort = new AbortController();
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
  });

  it("starts polling only once", async () => {
    expect(controller.isTelegramBotRunning()).toBe(false);

    await controller.launchTelegramBot();
    await controller.launchTelegramBot();

    expect(bot.launch).toHaveBeenCalledTimes(1);
    expect(controller.isTelegramBotRunning()).toBe(true);
  });

  it("resets the running state after startup fails and permits a retry", async () => {
    bot.launch.mockRejectedValueOnce(new Error("polling failed"));

    await expect(controller.launchTelegramBot()).rejects.toThrow(
      "polling failed",
    );
    expect(controller.isTelegramBotRunning()).toBe(false);

    await controller.launchTelegramBot();

    expect(controller.isTelegramBotRunning()).toBe(true);
    expect(bot.launch).toHaveBeenCalledTimes(2);
  });

  it("stops polling only when running", async () => {
    controller.stopTelegramBot();
    expect(bot.stop).not.toHaveBeenCalled();

    await controller.launchTelegramBot();
    controller.stopTelegramBot();
    controller.stopTelegramBot();

    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(controller.isTelegramBotRunning()).toBe(false);
  });

  it("keeps shutting down when Telegraf has nothing to stop yet", async () => {
    await controller.launchTelegramBot();
    bot.stop.mockImplementationOnce(() => {
      throw new Error("Bot is not running!");
    });

    expect(() => controller.stopTelegramBot()).not.toThrow();
    expect(controller.isTelegramBotRunning()).toBe(false);
  });

  it("rejects startup when Telegram is not configured", async () => {
    const unconfigured = createBot(null);

    await expect(unconfigured.launchTelegramBot()).rejects.toThrow(
      "Telegram is not configured",
    );
    expect(() => unconfigured.stopTelegramBot()).not.toThrow();
    await expect(unconfigured.shutdownTelegramBot()).resolves.toBeUndefined();
  });
});
