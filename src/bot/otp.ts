import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import { aborted } from "node:util";
import type { OtpRequest } from "../scraper/otp.js";

const logger = createLogger("otp");

export function createOtpHandler(bot: Telegraf<Context> | null) {
  const telegramConfig = config.options.notifications?.telegram;
  const pending = new Map<number, (text: string) => void>();
  const registering = new Set<Promise<number | undefined>>();

  bot?.on(message("text"), async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) return next();

    const replyToMessageId = ctx.message.reply_to_message?.message_id;
    let receive =
      replyToMessageId === undefined
        ? pending.size + registering.size === 1
          ? pending.values().next().value
          : undefined
        : pending.get(replyToMessageId);
    if (!receive && registering.size > 0) {
      if (replyToMessageId === undefined) {
        if (pending.size + registering.size !== 1) return next();
        const messageId = await registering.values().next().value!;
        receive = messageId === undefined ? undefined : pending.get(messageId);
      } else {
        // Only in-flight prompts can own an early reply; unrelated sends must not delay a match.
        const messageId = await Promise.any(
          Array.from(registering, async (registration) => {
            const messageId = await registration;
            if (messageId !== replyToMessageId)
              throw new Error("Unmatched OTP prompt");
            return messageId;
          }),
        ).catch((error: unknown) => {
          if (error instanceof AggregateError) return undefined;
          throw error;
        });
        receive = messageId === undefined ? undefined : pending.get(messageId);
      }
    }
    if (!receive) return next();

    receive(text);
    return ctx.reply("✅ OTP code received. Continuing authentication...");
  });

  const requestOtpCode: OtpRequest = async (companyId, phoneNumber, signal) => {
    signal?.throwIfAborted();
    if (!bot || !telegramConfig?.chatId || !telegramConfig.enableOtp) {
      throw new Error("Telegram OTP is not enabled or configured");
    }

    const timeoutSeconds = telegramConfig.otpTimeoutSeconds;
    const timeout = AbortSignal.timeout(timeoutSeconds * 1000);
    const completed = new AbortController();
    const combined = AbortSignal.any(
      [signal, timeout, completed.signal].filter(
        (signal) => signal !== undefined,
      ),
    );
    const response = Promise.withResolvers<string>();
    const registration = Promise.withResolvers<number | undefined>();
    const cancellation = aborted(combined, registration).then(() => undefined);
    registering.add(registration.promise);
    let messageId: number | undefined;

    try {
      const requestMessage = await Promise.race([
        bot.telegram.sendMessage(
          telegramConfig.chatId,
          `🔐 2FA Authentication Required\n\n` +
            `Account: ${companyId}\n` +
            `Please enter the OTP code sent to ${phoneNumber}:\n\n` +
            `Reply to this message with the code.`,
        ),
        cancellation,
      ]);
      signal?.throwIfAborted();
      if (!requestMessage || timeout.aborted) {
        throw new Error(
          `OTP timeout: No response received within ${timeoutSeconds} seconds`,
        );
      }
      messageId = requestMessage.message_id;
      logger("Waiting for OTP code from user...");
      pending.set(messageId, (text) => {
        pending.delete(requestMessage.message_id);
        response.resolve(text);
      });
      registering.delete(registration.promise);
      registration.resolve(messageId);
      const received = await Promise.race([response.promise, cancellation]);
      if (typeof received === "string") return received;
      signal?.throwIfAborted();
      throw new Error(
        `OTP timeout: No response received within ${timeoutSeconds} seconds`,
      );
    } finally {
      completed.abort();
      if (messageId !== undefined) pending.delete(messageId);
      registering.delete(registration.promise);
      registration.resolve(undefined);
    }
  };
  return requestOtpCode;
}
