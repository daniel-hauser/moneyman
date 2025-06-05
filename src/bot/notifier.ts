import { Telegraf, TelegramError } from "telegraf";
import { escapers } from "@telegraf/entity";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import type { ImageWithCaption } from "../types.js";

/**
 * Escapes content for MarkdownV2 while preserving intentional formatting like **>
 */
export function escapeMessageForMarkdownV2(message: string): string {
  // Split the message into lines to handle formatting carefully
  const lines = message.split("\n");

  return lines
    .map((line) => {
      // Check if this line starts with **> (expandable block quotation)
      const expandableBlockMatch = line.match(/^(\*\*>)(.*)$/);
      if (expandableBlockMatch) {
        // Preserve the **> syntax but escape the rest
        return `\\*\\*>${escapers.MarkdownV2(expandableBlockMatch[2])}`;
      }

      // For all other lines, escape the entire content using official escaper
      return escapers.MarkdownV2(line);
    })
    .join("\n");
}

const logger = createLogger("notifier");

const { TELEGRAM_API_KEY, TELEGRAM_CHAT_ID = "" } = process.env;

const bot =
  TELEGRAM_API_KEY && TELEGRAM_CHAT_ID ? new Telegraf(TELEGRAM_API_KEY) : null;

logToPublicLog(
  bot
    ? "Telegram logger initialized, status and errors will be sent"
    : "No Telegram bot info, status and errors will not be sent",
);

logger(`Telegram bot initialized: ${Boolean(bot)}`);
if (bot) {
  logger(`Telegram chat ID: ${TELEGRAM_CHAT_ID}`);
}

export async function send(
  message: string,
  parseMode?: "MarkdownV2" | "HTML" | "Markdown",
) {
  // Escape message content for MarkdownV2 format
  const finalMessage =
    parseMode === "MarkdownV2" ? escapeMessageForMarkdownV2(message) : message;

  if (finalMessage.length > 4096) {
    send(
      `Next message is too long (${finalMessage.length} characters), truncating`,
    );
    return send(finalMessage.slice(0, 4096), parseMode);
  }
  logger(finalMessage);
  const options = parseMode ? { parse_mode: parseMode } : undefined;
  return await bot?.telegram.sendMessage(
    TELEGRAM_CHAT_ID,
    finalMessage,
    options,
  );
}

export async function sendPhoto(photoPath: string, caption: string) {
  logger(`Sending photo`, { photoPath, caption });
  return await bot?.telegram.sendPhoto(
    TELEGRAM_CHAT_ID,
    { source: photoPath },
    { caption, has_spoiler: true },
  );
}

export async function sendPhotos(photos: Array<ImageWithCaption>) {
  logger(`Sending photos`, { photos });
  if (photos.length === 0) {
    return;
  }
  return await bot?.telegram.sendMediaGroup(
    TELEGRAM_CHAT_ID,
    photos.map(({ photoPath, caption }) => ({
      type: "photo",
      caption,
      media: { source: photoPath },
    })),
  );
}

export async function sendJSON(json: {}, filename: string) {
  logger(`Sending JSON`, { json, filename });
  const buffer = Buffer.from(JSON.stringify(json, null, 2), "utf-8");
  return await bot?.telegram.sendDocument(TELEGRAM_CHAT_ID, {
    source: buffer,
    filename,
  });
}

export async function editMessage(
  message: number | undefined,
  newText: string,
  parseMode?: "MarkdownV2" | "HTML" | "Markdown",
) {
  if (message !== undefined) {
    try {
      /**
       * Telegram has limit on the number of messages per second.
       * To avoid getting 429 errors, we wait a bit before sending the edit request.
       * According to the docs, the limit is 30 messages per second so we should be safe with 250ms.
       */
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Escape message content for MarkdownV2 format
      const finalText =
        parseMode === "MarkdownV2"
          ? escapeMessageForMarkdownV2(newText)
          : newText;

      const options = parseMode ? { parse_mode: parseMode } : undefined;
      await bot?.telegram.editMessageText(
        TELEGRAM_CHAT_ID,
        message,
        undefined,
        finalText,
        options,
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
