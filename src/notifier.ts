import { Telegraf, TelegramError } from "telegraf";
import { Message } from "telegraf/typings/core/types/typegram";
import { TELEGRAM_API_KEY, TELEGRAM_CHAT_ID } from "./config.js";
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
  if (message.length > 4096) {
    send(`Next message is too long (${message.length} characters), truncating`);
    return await bot?.telegram.sendMessage(
      TELEGRAM_CHAT_ID,
      message.slice(0, 4096),
    );
  }
  while (true) {
    try {
      const result = await bot?.telegram.sendMessage(TELEGRAM_CHAT_ID, message);
      return result;
    } catch (e) {
      if (e.response.error_code === 429) {
        logger(`Rate limited, waiting 10 seconds`);
        await new Promise((resolve) => setTimeout(resolve, 10000));
      } else {
        throw e; // re-throw the error if it's not a 429
      }
    }
  }
}

export async function deleteMessage(message: Message.TextMessage) {
  await bot?.telegram.deleteMessage(TELEGRAM_CHAT_ID, message.message_id);
}

export async function editMessage(
  message: number | undefined,
  newText: string,
) {
  if (message !== undefined) {
    while (true) {
      try {
        return await bot?.telegram.editMessageText(
          TELEGRAM_CHAT_ID,
          message,
          undefined,
          newText,
        );
      } catch (e) {
        if (canIgnoreTelegramError(e)) {
          logger(`Ignoring error`, e);
          break; // If the error can be ignored, break the loop
        } else if (e.response.error_code === 429) {
          logger(`Rate limited, starting 10 second delay`);
          await new Promise((resolve) => setTimeout(resolve, 10000));
          logger(`10 second delay ended, retrying`);
        } else {
          throw e; // If it's another error, throw it
        }
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
