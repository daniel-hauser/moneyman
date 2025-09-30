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

  const message = await send(
    `🔐 2FA Authentication Required\n\n` +
      `Account: ${companyId}\n` +
      `Please enter the OTP code sent to ${phoneNumber}:\n\n` +
      `Reply to this message with the code (digits only).`,
  );

  if (!message) {
    throw new Error("Failed to send OTP request message");
  }

  logger("Waiting for OTP code from user...");

  return new Promise((resolve, reject) => {
    let isResolved = false;

    const timeoutSeconds = telegramConfig.otpTimeoutSeconds ?? 300;
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        reject(
          new Error(
            `OTP timeout: No response received within ${timeoutSeconds} seconds`,
          ),
        );
      }
    }, timeoutSeconds * 1000);

    const cleanup = () => {
      clearTimeout(timeout);
      // Remove the handler by creating a new bot instance would be complex
      // For now, we'll rely on the timeout and isResolved flag
    };

    // Listen for any text message from the correct chat
    const handler = (ctx: any) => {
      if (isResolved) return;

      // Check if message is from the correct chat
      if (ctx.chat?.id?.toString() !== telegramConfig.chatId) {
        return;
      }

      const text = ctx.message?.text?.trim();
      if (!text) {
        return;
      }

      // Validate OTP format (should be digits only, typically 4-8 digits)
      const otpRegex = /^\d{4,8}$/;
      if (!otpRegex.test(text)) {
        void send(
          "❌ Invalid OTP format. Please enter digits only (4-8 digits).",
        );
        return;
      }

      // Valid OTP received
      if (!isResolved) {
        isResolved = true;
        cleanup();

        logger(`Received OTP code: ${text.substring(0, 2)}...`);
        void send("✅ OTP code received. Continuing authentication...");

        resolve(text);
      }
    };

    bot.on("text", handler);

    // Start the bot if needed (this is safe to call multiple times)
    bot
      .launch()
      .then(() => {
        logger("Bot launched for OTP collection");
      })
      .catch((error) => {
        // Ignore "already running" errors
        if (!error.message.includes("already running") && !isResolved) {
          isResolved = true;
          cleanup();
          reject(
            new Error(`Failed to start Telegram bot for OTP: ${error.message}`),
          );
        }
      });
  });
}
