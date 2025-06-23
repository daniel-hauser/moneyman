import { Telegraf, TelegramError } from "telegraf";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import type { ImageWithCaption } from "../types.js";
import { config } from "../config.js";

const logger = createLogger("notifier");

const telegramConfig = config.options.notifications.telegram;
const bot = telegramConfig ? new Telegraf(telegramConfig.apiKey) : null;

logToPublicLog(
  bot
    ? "Telegram logger initialized, status and errors will be sent"
    : "No Telegram bot info, status and errors will not be sent",
);

logger(`Telegram bot initialized: ${Boolean(bot)}`);
if (bot && telegramConfig) {
  logger(`Telegram chat ID: ${telegramConfig.chatId}`);
}

export async function send(message: string, parseMode?: "HTML") {
  if (message.length > 4096) {
    send(`Next message is too long (${message.length} characters), truncating`);
    return send(message.slice(0, 4096));
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

export async function editMessage(
  message: number | undefined,
  newText: string,
  parseMode?: "HTML",
) {
  if (message === undefined || !bot || !telegramConfig?.chatId) {
    return;
  }

  try {
    /**
     * Telegram has limit on the number of messages per second.
     * To avoid getting 429 errors, we wait a bit before sending the edit request.
     * According to the docs, the limit is 30 messages per second so we should be safe with 250ms.
     */
    await new Promise((resolve) => setTimeout(resolve, 250));
    await bot.telegram.editMessageText(
      telegramConfig.chatId,
      message,
      undefined,
      newText,
      {
        parse_mode: parseMode,
      },
    );
  } catch (e) {
    if (canIgnoreTelegramError(e)) {
      logger(`Ignoring error`, e);
    } else {
      throw e;
    }
  }
}

function canIgnoreTelegramError(e: Error) {
  return (
    e instanceof TelegramError &&
    e.response.description.startsWith("Bad Request: message is not modified")
  );
}

export function sendError(message: any, caller: string = "") {
  return send(
    `${caller}\n❌ ${String(
      message instanceof Error
        ? `${message.message}\n${message.stack}`
        : message,
    )}`.trim(),
  );
}

const deprecationMessages = {
  ["hashFiledChange"]: `This run is using the old transaction hash field, please update to the new one (it might require manual de-duping of some transactions). See https://github.com/daniel-hauser/moneyman/issues/268 for more details.`,
} as const;
logger(`Hidden deprecations: ${config.options.scraping.hiddenDeprecations}`);

const sentDeprecationMessages = new Set<string>(
  config.options.scraping.hiddenDeprecations,
);

export function sendDeprecationMessage(
  messageId: keyof typeof deprecationMessages,
) {
  if (sentDeprecationMessages.has(messageId)) {
    return;
  }
  // Avoid sending the same message multiple times
  sentDeprecationMessages.add(messageId);
  return send(`⚠️ Deprecation warning:
${deprecationMessages[messageId]}`);
}
