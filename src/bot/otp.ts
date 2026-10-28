import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { waitForAbortSignal } from "../utils/promises.js";
import { formatUnknownError } from "../utils/utils.js";

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
  let activeOtpRequests = 0;
  let otpFlowOwnsBot = false;

  return async function requestOtpCode(
    companyId: string,
    phoneNumber: string,
  ): Promise<string> {
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

    logger("Waiting for OTP code from user...");

    const timeoutSeconds = telegramConfig.otpTimeoutSeconds;
    const timeoutPromise = waitForAbortSignal(
      AbortSignal.timeout(timeoutSeconds * 1000),
    ).catch(() => {
      throw new Error(
        `OTP timeout: No response received within ${timeoutSeconds} seconds`,
      );
    });

    const ownsBot = !polling.isTelegramBotRunning();
    activeOtpRequests++;
    if (ownsBot) {
      otpFlowOwnsBot = true;
    }

    let awaitingResponse = true;
    const responsePromise = new Promise<string>((resolve, reject) => {
      const handler = (ctx: Context, next: () => Promise<void>) => {
        if (
          !awaitingResponse ||
          ctx.chat?.id?.toString() !== telegramConfig.chatId ||
          !ctx.message ||
          !("text" in ctx.message)
        ) {
          return next();
        }

        const text = ctx.message.text?.trim();
        if (!text) return next();

        // With concurrent requests, only a reply identifies its intended account.
        const replyToMessageId = ctx.message.reply_to_message?.message_id;
        if (
          replyToMessageId === undefined
            ? activeOtpRequests > 1
            : replyToMessageId !== requestMessage.message_id
        ) {
          return next();
        }

        logger(`Received OTP code: ${text}`);
        awaitingResponse = false;
        void ctx.reply("✅ OTP code received. Continuing authentication...");
        resolve(text);
      };

      bot.on(message("text"), handler);

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
      return await Promise.race([responsePromise, timeoutPromise]);
    } finally {
      awaitingResponse = false;
      activeOtpRequests--;

      // OTP must not stop polling owned by the long-running server.
      if (activeOtpRequests === 0 && otpFlowOwnsBot) {
        otpFlowOwnsBot = false;
        polling.stopTelegramBot();
      }
    }
  };
}
