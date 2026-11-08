import { Context, Telegraf } from "telegraf";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import { aborted } from "node:util";
import { locks } from "node:worker_threads";
import { formatUnknownError } from "../utils/utils.js";
import { createOtpHandler } from "./otp.js";
import { config } from "../config.js";
import type { OtpRequest } from "../scraper/otp.js";

const logger = createLogger("bot");

export const COMMAND_MENU_LOCK = "moneyman-command-menu";

export function isAuthorizedChat(ctx: Context): boolean {
  const chatId = config.options.notifications?.telegram?.chatId;
  return Boolean(chatId) && ctx.chat?.id?.toString() === chatId;
}

export function createBot(bot: Telegraf<Context> | null) {
  bot?.use((ctx, next) => {
    if (isAuthorizedChat(ctx)) return next();
    logger(`Ignoring an update from unauthorized chat ${ctx.chat?.id}`);
  });

  let polling: TelegramPolling | undefined;
  let pollingSignal: AbortSignal | undefined;
  let shutdown: Promise<void> | undefined;
  const receiveOtp = createOtpHandler(bot);

  function createPolling(bot: Telegraf<Context>): TelegramPolling {
    const availability = new AbortController();
    pollingSignal = availability.signal;
    const lifetime = bot.launch(() => logger("Telegram bot launched"));
    void lifetime.then(
      () =>
        availability.abort(
          new Error("Telegram bot stopped while waiting for OTP"),
        ),
      (error: unknown) => {
        availability.abort(error);
        logger("Telegram bot polling failed", error);
        if (polling?.lifetime === lifetime) polling = undefined;
      },
    );
    let stopping: Promise<void> | undefined;

    async function stopInternal(): Promise<void> {
      availability.abort(
        new Error("Telegram bot stopped while waiting for OTP"),
      );
      try {
        bot.stop();
        await lifetime;
      } catch (error) {
        logger(`Failed to stop the Telegram bot: ${formatUnknownError(error)}`);
      }
    }

    function stop(signal?: AbortSignal): Promise<void> {
      stopping ??= stopInternal();
      return signal ? Promise.race([stopping, aborted(signal, bot)]) : stopping;
    }

    return { lifetime, stop };
  }

  function launchTelegramBot(): Promise<void> {
    if (!bot) return Promise.reject(new Error("Telegram is not configured"));
    polling ??= createPolling(bot);
    return polling.lifetime;
  }

  const requestOtpCode: OtpRequest = (companyId, phoneNumber, signal) => {
    if (!pollingSignal) {
      return Promise.reject(new Error("Telegram bot polling is unavailable"));
    }
    return receiveOtp(
      companyId,
      phoneNumber,
      AbortSignal.any(
        [signal, pollingSignal].filter((signal) => signal !== undefined),
      ),
    );
  };

  function stopTelegramBot(signal?: AbortSignal): Promise<void> {
    return polling?.stop(signal) ?? Promise.resolve();
  }

  function shutdownTelegramBot(): Promise<void> {
    shutdown ??= shutdownWithDeadline();
    return shutdown;
  }

  async function shutdownWithDeadline(): Promise<void> {
    const chatId = config.options.notifications?.telegram?.chatId;
    const completed = new AbortController();
    const signal = AbortSignal.any([
      AbortSignal.timeout(3_000),
      completed.signal,
    ]);
    try {
      const [stopResult, clearResult] = await Promise.allSettled([
        stopTelegramBot(signal),
        bot && chatId
          ? Promise.race([
              locks.request(COMMAND_MENU_LOCK, { signal }, () => {
                signal.throwIfAborted();
                return bot.telegram.deleteMyCommands({
                  scope: { type: "chat", chat_id: chatId },
                });
              }),
              aborted(signal, bot).then(() => signal.throwIfAborted()),
            ])
          : Promise.resolve(),
      ]);
      if (stopResult.status === "rejected") {
        logger("Failed to stop Telegram polling", stopResult.reason);
      }
      if (clearResult.status === "rejected") {
        throw clearResult.reason;
      }
    } catch (error) {
      logger("Failed to clear Telegram command menu", error);
      logToPublicLog("Failed to clear Telegram command menu", logger);
    } finally {
      completed.abort();
    }
  }

  return {
    launchTelegramBot,
    stopTelegramBot,
    shutdownTelegramBot,
    requestOtpCode,
  };
}

type TelegramPolling = {
  lifetime: Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
};
