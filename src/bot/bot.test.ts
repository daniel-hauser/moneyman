import { mockDeep } from "jest-mock-extended";
import { Context, Telegraf } from "telegraf";
import { createBot } from "./bot.js";

jest.mock("../config.js", () => ({
  config: { options: { notifications: {} } },
}));

describe("createBot", () => {
  const bot = mockDeep<Telegraf<Context>>();
  let controller: ReturnType<typeof createBot>;

  beforeEach(() => {
    jest.clearAllMocks();
    bot.launch.mockResolvedValue(undefined);
    controller = createBot(bot);
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
  });
});
