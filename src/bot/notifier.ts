import { Telegraf } from "telegraf";
import { config } from "../config.js";
import type { ImageWithCaption } from "../types.js";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import { formatUnknownError } from "../utils/utils.js";
import { assignDeprecationHandler } from "./deprecationManager.js";
import type { ReportTransport } from "./reportPublisher.js";
import { createBot } from "./bot.js";

const logger = createLogger("notifier");

const telegramConfig = config.options.notifications?.telegram;
const bot = telegramConfig ? new Telegraf(telegramConfig.apiKey) : null;

logToPublicLog(
  bot
    ? "Telegram logger initialized, status and errors will be sent"
    : "No Telegram bot info, status and errors will not be sent",
  logger,
);

logger(`Telegram bot initialized: ${Boolean(bot)}`);
if (bot && telegramConfig) {
  logger(`Telegram chat ID: ${telegramConfig.chatId}`);

  assignDeprecationHandler((messageId, message) => {
    if (!config.options.scraping.hiddenDeprecations?.includes(messageId)) {
      logger(`Sending deprecation message: ${messageId}`);
      void send(message);
    }
  });
}

export const {
  isTelegramBotRunning,
  launchTelegramBot,
  stopTelegramBot,
  shutdownTelegramBot,
  requestOtpCode,
} = createBot(bot);

/** The shared Telegram bot, or `null` when Telegram is not configured */
export function getTelegramBot() {
  return bot;
}

export async function send(message: string, parseMode?: "HTML") {
  if (message.length > 4096) {
    await send(
      `Next message is too long (${message.length} characters), truncating`,
    );
    await send(message.slice(0, 4096));

    if (bot && telegramConfig?.chatId) {
      const buffer = Buffer.from(message, "utf-8");
      await bot.telegram.sendDocument(
        telegramConfig.chatId,
        {
          source: buffer,
          filename: `message-${new Date().toISOString().replaceAll(":", "-")}.txt`,
        },
        {
          caption: "Full message attached",
        },
      );
    }
    return;
  }
  logger(message);
  if (!bot || !telegramConfig?.chatId) {
    return;
  }
  return await bot.telegram.sendMessage(telegramConfig.chatId, message, {
    parse_mode: parseMode,
  });
}

export async function sendPhoto(photoPath: string, caption: string) {
  logger(`Sending photo`, { photoPath, caption });
  if (!bot || !telegramConfig?.chatId) {
    return;
  }
  return await bot.telegram.sendPhoto(
    telegramConfig.chatId,
    { source: photoPath },
    { caption, has_spoiler: true },
  );
}

export async function sendPhotos(photos: Array<ImageWithCaption>) {
  logger(`Sending photos`, { photos });
  if (photos.length === 0 || !bot || !telegramConfig?.chatId) {
    return;
  }
  return await bot.telegram.sendMediaGroup(
    telegramConfig.chatId,
    photos.map(({ photoPath, caption }) => ({
      type: "photo",
      caption,
      media: { source: photoPath },
    })),
  );
}

export async function sendJSON(json: {}, filename: string) {
  logger(`Sending JSON`, { json, filename });
  if (!bot || !telegramConfig?.chatId) {
    return;
  }
  const buffer = Buffer.from(JSON.stringify(json, null, 2), "utf-8");
  return await bot.telegram.sendDocument(telegramConfig.chatId, {
    source: buffer,
    filename,
  });
}

export async function sendTextFile(filePath: string, caption?: string) {
  logger(`Sending file`, { filePath, caption });
  if (!bot || !telegramConfig?.chatId) {
    return;
  }
  return await bot.telegram.sendDocument(
    telegramConfig.chatId,
    { source: filePath, filename: `${filePath}.txt` },
    caption ? { caption } : undefined,
  );
}

/**
 * Transport for the single run-report message, undefined when Telegram isn't configured.
 * Errors (e.g. 429) are propagated so the publisher can handle them.
 */
export const reportTransport: ReportTransport | undefined =
  bot && telegramConfig?.chatId
    ? {
        async send(text) {
          const sent = await bot.telegram.sendMessage(
            telegramConfig.chatId,
            text,
            { parse_mode: "HTML" },
          );
          return sent.message_id;
        },
        async edit(messageId, text) {
          await bot.telegram.editMessageText(
            telegramConfig.chatId,
            messageId,
            undefined,
            text,
            { parse_mode: "HTML" },
          );
        },
        async sendFile(filename, content) {
          logger(`Sending file ${filename}`);
          await bot.telegram.sendDocument(telegramConfig.chatId, {
            source: Buffer.from(content, "utf-8"),
            filename,
          });
        },
      }
    : undefined;

export const reportUpdateIntervalMs = telegramConfig?.updateIntervalMs;

export function sendError(message: unknown, caller: string = "") {
  return send(
    `${caller}\n❌ ${String(
      message instanceof Error
        ? `${message.message}\n${message.stack}`
        : formatUnknownError(message),
    )}`.trim(),
  );
}
