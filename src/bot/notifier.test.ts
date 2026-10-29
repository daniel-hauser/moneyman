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
  expect(notifier.shutdownTelegramBot).toBe(controller.shutdownTelegramBot);
  expect(notifier.isTelegramBotRunning).toBe(controller.isTelegramBotRunning);
  expect(notifier.requestOtpCode).toBe(controller.requestOtpCode);
});

it("includes both operation and disposal failures in Telegram errors", async () => {
  const notifier = await import("./notifier.js");
  const bot = notifier.getTelegramBot()!;
  const send = jest
    .spyOn(bot.telegram, "sendMessage")
    .mockResolvedValue(mock());
  try {
    await notifier.sendError(
      new SuppressedError(
        new Error("worker cleanup failed"),
        new Error("scraper failed"),
      ),
      "scraper",
    );
    expect(send).toHaveBeenCalledWith(
      "555",
      expect.stringContaining(
        "scraper failed; cleanup failed: worker cleanup failed",
      ),
      { parse_mode: undefined },
    );
  } finally {
    send.mockRestore();
  }
});
