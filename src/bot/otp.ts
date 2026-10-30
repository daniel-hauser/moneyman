import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { formatUnknownError } from "../utils/utils.js";
import { aborted } from "node:util";

const logger = createLogger("otp");

export function createOtpHandler(
  bot: Telegraf<Context> | null,
  polling: {
    isTelegramBotRunning(): boolean;
    launchTelegramBot(): Promise<void>;
    stopTelegramBot(): void;
  },
) {
  const telegramConfig = config.options.notifications?.telegram;
  const pending = new Map<number, (text: string) => void>();
  let otpFlowOwnsBot = false;

  bot?.on(message("text"), (ctx, next) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) return next();

    const replyToMessageId = ctx.message.reply_to_message?.message_id;
    const receive =
      replyToMessageId === undefined
        ? pending.size === 1
          ? pending.values().next().value
          : undefined
        : pending.get(replyToMessageId);
    if (!receive) return next();

    receive(text);
    return ctx.reply("✅ OTP code received. Continuing authentication...");
  });

  return async function requestOtpCode(
    companyId: string,
    phoneNumber: string,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted();
    if (!bot || !telegramConfig?.chatId || !telegramConfig.enableOtp) {
      throw new Error("Telegram OTP is not enabled or configured");
    }

    const requestMessage = await bot.telegram.sendMessage(
      telegramConfig.chatId,
      `🔐 2FA Authentication Required\n\n` +
        `Account: ${companyId}\n` +
        `Please enter the OTP code sent to ${phoneNumber}:\n\n` +
        `Reply to this message with the code.`,
    );
    signal?.throwIfAborted();

    logger("Waiting for OTP code from user...");

    const timeoutSeconds = telegramConfig.otpTimeoutSeconds;
    const ownsBot = !polling.isTelegramBotRunning();
    if (ownsBot) {
      otpFlowOwnsBot = true;
    }

    const timeout = AbortSignal.timeout(timeoutSeconds * 1000);
    const completed = new AbortController();
    const combined = AbortSignal.any(
      [signal, timeout, completed.signal].filter(
        (signal) => signal !== undefined,
      ),
    );
    const responsePromise = new Promise<string>((resolve, reject) => {
      pending.set(requestMessage.message_id, (text) => {
        pending.delete(requestMessage.message_id);
        resolve(text);
      });
      if (!ownsBot) return;

      polling.launchTelegramBot().catch((error) => {
        logger("Failed to start Telegram bot for OTP", error);
        void bot.telegram
          .sendMessage(
            telegramConfig.chatId,
            `requestOtpCode\n❌ ${
              error instanceof Error
                ? `${error.message}\n${error.stack}`
                : formatUnknownError(error)
            }`,
          )
          .catch((notificationError) =>
            logger("Failed to send OTP error notification", notificationError),
          );
        reject(new Error(`Failed to start Telegram bot for OTP: ${error}`));
      });
    });

    try {
      const response = await Promise.race([
        responsePromise,
        aborted(combined, requestMessage),
      ]);
      if (typeof response === "string") return response;
      signal?.throwIfAborted();
      throw new Error(
        `OTP timeout: No response received within ${timeoutSeconds} seconds`,
      );
    } finally {
      completed.abort();
      pending.delete(requestMessage.message_id);

      // OTP must not stop polling owned by the long-running server.
      if (pending.size === 0 && otpFlowOwnsBot) {
        otpFlowOwnsBot = false;
        polling.stopTelegramBot();
      }
    }
  };
}
