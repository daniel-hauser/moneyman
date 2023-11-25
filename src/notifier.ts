import { Telegraf, TelegramError } from "telegraf";
import { Message } from "telegraf/typings/core/types/typegram";
import {
  daysBackToScrape,
  scrapeStartDate,
  TELEGRAM_API_KEY,
  TELEGRAM_CHAT_ID,
  worksheetName,
} from "./config.js";
import { createLogger, logToPublicLog } from "./utils/logger.js";

const logger = createLogger("notifier");

const bot =
  TELEGRAM_API_KEY && TELEGRAM_CHAT_ID ? new Telegraf(TELEGRAM_API_KEY) : null;

logToPublicLog(
  bot
    ? "Telegram logger initialized, status and errors will be sent"
    : "No Telegram bot info, status and errors will not be sent",
);

export async function send(message: string) {
  logger(message);
  return await bot?.telegram.sendMessage(TELEGRAM_CHAT_ID, message);
}

export async function deleteMessage(message: Message.TextMessage) {
  await bot?.telegram.deleteMessage(TELEGRAM_CHAT_ID, message.message_id);
}

export async function editMessage(
  message: number | undefined,
  newText: string,
) {
  if (message !== undefined) {
    try {
      await bot?.telegram.editMessageText(
        TELEGRAM_CHAT_ID,
        message,
        undefined,
        newText,
      );
    } catch (e) {
      if (canIgnoreTelegramError(e)) {
        logger(`Ignoring error`, e);
      } else {
        throw e;
      }
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

export function getConfigSummary() {
  return `
Config:
  Worksheet name: ${worksheetName}
  Start Date: ${scrapeStartDate.toISOString()} (${daysBackToScrape} days back)
  TZ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
  `;
}
