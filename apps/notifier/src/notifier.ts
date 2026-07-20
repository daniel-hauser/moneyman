import { Context, Telegraf, TelegramError } from "telegraf";
import { message } from "telegraf/filters";
import { waitForAbortSignal, createLogger } from "@moneyman/common";
import type { ImagePayload } from "@moneyman/protocol";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "./config.js";

const logger = createLogger("notifier");
const telegramConfig = config.telegram;
const telegramProxy = process.env.HTTPS_PROXY
  ? new HttpsProxyAgent(process.env.HTTPS_PROXY)
  : undefined;
const bot = telegramConfig
  ? new Telegraf(telegramConfig.apiKey, {
      telegram: {
        agent: telegramProxy,
        attachmentAgent: telegramProxy,
      },
    })
  : null;

export async function send(messageText: string, parseMode?: "HTML") {
  if (messageText.length > 4096) {
    await send(
      `Next message is too long (${messageText.length} characters), truncating`,
    );
    await send(messageText.slice(0, 4096));
    await sendJson(messageText, "full-message.txt");
    return {};
  }

  logger(messageText);
  if (!bot || !telegramConfig) {
    return {};
  }

  const response = await bot.telegram.sendMessage(
    telegramConfig.chatId,
    messageText,
    { parse_mode: parseMode },
  );
  return { messageId: response.message_id };
}

export async function editMessage(
  messageId: number | undefined,
  newText: string,
  parseMode?: "HTML",
) {
  if (messageId === undefined || !bot || !telegramConfig) {
    return;
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await bot.telegram.editMessageText(
      telegramConfig.chatId,
      messageId,
      undefined,
      newText,
      { parse_mode: parseMode },
    );
  } catch (error) {
    if (!canIgnoreTelegramError(error)) {
      throw error;
    }
    logger("Ignoring unchanged Telegram message");
  }
}

export async function sendImages(images: ImagePayload[]) {
  if (images.length === 0 || !bot || !telegramConfig) {
    return;
  }
  await bot.telegram.sendMediaGroup(
    telegramConfig.chatId,
    images.map(({ contentBase64, caption }) => ({
      type: "photo",
      caption,
      has_spoiler: true,
      media: { source: Buffer.from(contentBase64, "base64") },
    })),
  );
}

export async function sendJson(json: unknown, filename: string) {
  if (!bot || !telegramConfig) {
    return;
  }
  await bot.telegram.sendDocument(telegramConfig.chatId, {
    source: Buffer.from(
      typeof json === "string" ? json : JSON.stringify(json, null, 2),
      "utf8",
    ),
    filename,
  });
}

export async function sendTextFile(
  content: string,
  filename: string,
  caption?: string,
) {
  if (!bot || !telegramConfig) {
    return;
  }
  await bot.telegram.sendDocument(
    telegramConfig.chatId,
    { source: Buffer.from(content, "utf8"), filename },
    caption ? { caption } : undefined,
  );
}

export async function requestOtpCode(
  companyId: string,
  phoneNumber: string,
): Promise<string> {
  if (!bot || !telegramConfig?.enableOtp) {
    throw new Error("Telegram OTP is not enabled or configured");
  }

  const requestMessage = await bot.telegram.sendMessage(
    telegramConfig.chatId,
    `2FA Authentication Required\n\nAccount: ${companyId}\nPlease enter the OTP code sent to ${phoneNumber} by replying to this message.`,
  );

  const timeoutPromise = waitForAbortSignal(
    AbortSignal.timeout(telegramConfig.otpTimeoutSeconds * 1000),
  ).then(() => {
    throw new Error(
      `OTP timeout after ${telegramConfig.otpTimeoutSeconds} seconds`,
    );
  });

  const responsePromise = new Promise<string>((resolve, reject) => {
    const handler = (context: Context) => {
      if (
        context.chat?.id.toString() !== telegramConfig.chatId ||
        !context.message ||
        !("text" in context.message) ||
        context.message.reply_to_message?.message_id !==
          requestMessage.message_id
      ) {
        return;
      }

      const code = context.message.text.trim();
      if (!code) {
        return;
      }
      void context.reply("OTP code received. Continuing authentication.");
      resolve(code);
    };

    bot.on(message("text"), handler);
    bot.launch().catch((error: Error) => {
      if (!error.message.includes("already running")) {
        reject(error);
      }
    });
  });

  try {
    return await Promise.race([responsePromise, timeoutPromise]);
  } finally {
    bot.stop();
  }
}

function canIgnoreTelegramError(error: unknown) {
  return (
    error instanceof TelegramError &&
    error.response.description.startsWith(
      "Bad Request: message is not modified",
    )
  );
}
