import { mock } from "jest-mock-extended";
import { Telegraf } from "telegraf";
import type { Message } from "telegraf/types";
import { createBot } from "./bot.js";

const mockLogger = jest.fn();

jest.mock("../config.js", () => ({
  config: {
    options: {
      notifications: { telegram: { apiKey: "test-token", chatId: "555" } },
      scraping: {},
    },
  },
}));
jest.mock("./bot.js", () => ({ createBot: jest.fn() }));
jest.mock("../utils/logger.js", () => ({
  createLogger: () => mockLogger,
  logToPublicLog: jest.fn(),
}));

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

it.each([
  { count: 1, single: 1, grouped: 0 },
  { count: 10, single: 0, grouped: 1 },
  { count: 11, single: 1, grouped: 1 },
])(
  "delivers $count failure screenshots within Telegram's limits",
  async ({ count, single, grouped }) => {
    const notifier = await import("./notifier.js");
    const bot = notifier.getTelegramBot()!;
    const sendPhoto = jest
      .spyOn(bot.telegram, "sendPhoto")
      .mockResolvedValue(mock<Message.PhotoMessage>());
    const sendMediaGroup = jest
      .spyOn(bot.telegram, "sendMediaGroup")
      .mockResolvedValue([]);
    const photos = Array.from({ length: count }, (_, index) => ({
      photoPath: `screenshot-${index}.png`,
      caption: `Failure ${index}`,
    }));

    try {
      await notifier.sendPhotos(photos);

      expect(sendPhoto).toHaveBeenCalledTimes(single);
      expect(sendMediaGroup).toHaveBeenCalledTimes(grouped);
      const groupSizes = sendMediaGroup.mock.calls.map(
        ([, media]) => media.length,
      );
      expect(groupSizes.every((size) => size >= 2 && size <= 10)).toBe(true);
      expect(photosDelivered(sendPhoto, sendMediaGroup)).toBe(count);
    } finally {
      sendPhoto.mockRestore();
      sendMediaGroup.mockRestore();
    }
  },
);

function photosDelivered(
  sendPhoto: jest.SpiedFunction<Telegraf["telegram"]["sendPhoto"]>,
  sendMediaGroup: jest.SpiedFunction<Telegraf["telegram"]["sendMediaGroup"]>,
): number {
  const singles = sendPhoto.mock.calls.length;
  const grouped = sendMediaGroup.mock.calls.reduce(
    (total, [, media]) => total + media.length,
    0,
  );
  return singles + grouped;
}

it("logs deprecation warning delivery failures without rejecting", async () => {
  const notifier = await import("./notifier.js");
  const { sendDeprecationMessage } = await import("./deprecationManager.js");
  const bot = notifier.getTelegramBot()!;
  const failure = new Error("Telegram is unavailable");
  const send = jest
    .spyOn(bot.telegram, "sendMessage")
    .mockRejectedValue(failure);
  mockLogger.mockClear();

  try {
    expect(() => sendDeprecationMessage("hashFiledChange")).not.toThrow();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(mockLogger).toHaveBeenCalledWith(
      "Failed to send deprecation message: hashFiledChange",
      failure,
    );
  } finally {
    send.mockRestore();
  }
});
