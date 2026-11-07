import { Context, Telegraf } from "telegraf";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import { aborted } from "node:util";
import { formatUnknownError } from "../utils/utils.js";
import { createOtpHandler } from "./otp.js";
import { config } from "../config.js";

const logger = createLogger("bot");

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
  let shutdown: Promise<void> | undefined;

  function createPolling(bot: Telegraf<Context>): TelegramPolling {
    const lifetime = bot.launch(() => logger("Telegram bot launched"));
    lifetime.catch((error) => {
      logger("Telegram bot polling failed", error);
      if (polling?.lifetime === lifetime) polling = undefined;
    });
    let stopping: Promise<void> | undefined;

    async function stopInternal(): Promise<void> {
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

  function stopTelegramBot(signal?: AbortSignal): Promise<void> {
    return polling?.stop(signal) ?? Promise.resolve();
  }

  function shutdownTelegramBot(): Promise<void> {
    shutdown ??= shutdownWithDeadline();
    return shutdown;
  }

  async function shutdownWithDeadline(): Promise<void> {
    const completed = new AbortController();
    const signal = AbortSignal.any([
      AbortSignal.timeout(3_000),
      completed.signal,
    ]);
    try {
      const [stopResult, clearResult] = await Promise.allSettled([
        stopTelegramBot(signal),
        bot
          ? Promise.race([
              bot.telegram.deleteMyCommands(),
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
    requestOtpCode: createOtpHandler(bot),
  };
}

type TelegramPolling = {
  lifetime: Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
};
