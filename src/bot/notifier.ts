import { Telegraf, TelegramError, Context } from "telegraf";
import { message } from "telegraf/filters";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import type { ImageWithCaption } from "../types.js";
import { config } from "../config.js";
import { waitForAbortSignal } from "../utils/promises.js";
import { assignDeprecationHandler } from "./deprecationManager.js";

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

/**
 * Request an OTP code from the user via Telegram and wait for their response
 */
export async function requestOtpCode(
  companyId: string,
  phoneNumber: string,
): Promise<string> {
  if (!bot || !telegramConfig?.chatId || !telegramConfig.enableOtp) {
    throw new Error("Telegram OTP is not enabled or configured");
  }

  const requestMessage = await send(
    `🔐 2FA Authentication Required\n\n` +
      `Account: ${companyId}\n` +
      `Please enter the OTP code sent to ${phoneNumber}:\n\n` +
      `Reply to this message with the code.`,
  );

  if (!requestMessage) {
    throw new Error("Failed to send OTP request message");
  }

  logger("Waiting for OTP code from user...");

  const timeoutSeconds = telegramConfig.otpTimeoutSeconds;
  const timeoutPromise = waitForAbortSignal(
    AbortSignal.timeout(timeoutSeconds * 1000),
  ).catch(() => {
    throw new Error(
      `OTP timeout: No response received within ${timeoutSeconds} seconds`,
    );
  });

  const responsePromise = new Promise<string>((resolve, reject) => {
    const handler = (ctx: Context) => {
      if (ctx.chat?.id?.toString() !== telegramConfig.chatId) {
        return;
      }

      if (!ctx.message || !("text" in ctx.message)) {
        return;
      }

      const text = ctx.message.text?.trim();
      if (!text) {
        return;
      }

      logger(`Received OTP code: ${text}`);
      void ctx.reply("✅ OTP code received. Continuing authentication...");

      resolve(text);
    };

    bot.on(message("text"), handler);

    bot
      .launch(() => {
        logger("Bot launched for OTP collection");
      })
      .catch((error) => {
        if (!error.message.includes("already running")) {
          sendError(error, "requestOtpCode");
          reject(
            new Error(`Failed to start Telegram bot for OTP: ${error.message}`),
          );
        }
      });
  });

  try {
    return await Promise.race([responsePromise, timeoutPromise]);
  } finally {
    bot.stop();
  }
}
