import { Telegraf, TelegramError } from "telegraf";
import { Message } from "telegraf/typings/core/types/typegram";
import { TELEGRAM_API_KEY, TELEGRAM_CHAT_ID } from "./config/ScrapeConfig.js";
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
  if (message.length > 4096) {
    send(`Next message is too long (${message.length} characters), truncating`);
    return send(message.slice(0, 4096));
  }
  logger(message);
  return await bot?.telegram.sendMessage(TELEGRAM_CHAT_ID, message);
}

export async function sendPhoto(photoPath: string, caption: string) {
  logger(`Sending photo`, { photoPath, caption });
  return await bot?.telegram.sendPhoto(
    TELEGRAM_CHAT_ID,
    { source: photoPath },
    { caption, has_spoiler: true },
  );
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
      /**
       * Telegram has limit on the number of messages per second.
       * To avoid getting 429 errors, we wait a bit before sending the edit request.
       * According to the docs, the limit is 30 messages per second so we should be safe with 250ms.
       */
      await new Promise((resolve) => setTimeout(resolve, 250));
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

const deprecationMessages = {
  ["hashFiledChange"]: `This run is using the old transaction hash field, please update to the new one (it might require manual de-duping of some transactions). See https://github.com/daniel-hauser/moneyman/issues/268 for more details.`,
} as const;
const { HIDDEN_DEPRECATIONS = "" } = process.env;
logger(`Hidden deprecations: ${HIDDEN_DEPRECATIONS}`);

const sentDeprecationMessages = new Set<string>(HIDDEN_DEPRECATIONS.split(","));

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
