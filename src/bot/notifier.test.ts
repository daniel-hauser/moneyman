import { mock } from "jest-mock-extended";
import { Telegraf } from "telegraf";
import { createBot } from "./bot.js";

jest.mock("../config.js", () => ({
  config: {
    options: {
      notifications: { telegram: { apiKey: "test-token", chatId: "555" } },
      scraping: {},
    },
  },
}));
jest.mock("./bot.js", () => ({ createBot: jest.fn() }));

it("shares the notifier's Telegram instance with the bot controller", async () => {
  const controller = mock<ReturnType<typeof createBot>>();
  jest.mocked(createBot).mockReturnValue(controller);

  const notifier = await import("./notifier.js");

  expect(notifier.getTelegramBot()).toBeInstanceOf(Telegraf);
  expect(createBot).toHaveBeenCalledTimes(1);
  expect(createBot).toHaveBeenCalledWith(notifier.getTelegramBot());
  expect(notifier.launchTelegramBot).toBe(controller.launchTelegramBot);
  expect(notifier.stopTelegramBot).toBe(controller.stopTelegramBot);
  expect(notifier.isTelegramBotRunning).toBe(controller.isTelegramBotRunning);
  expect(notifier.requestOtpCode).toBe(controller.requestOtpCode);
});
