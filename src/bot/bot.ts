import { Context, Telegraf } from "telegraf";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import { aborted } from "node:util";
import { setTimeout } from "node:timers/promises";
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
  function shutdownTelegramBot(polling?: TelegramPolling): Promise<void> {
    if (polling) return polling.shutdown();
    return shutdown();
  }

  async function shutdown(polling?: TelegramPolling): Promise<void> {
    const completed = new AbortController();
    const signal = AbortSignal.any([
      AbortSignal.timeout(3_000),
      completed.signal,
    ]);
    try {
      const stopped = polling?.stop(signal);
      if (!bot) {
        if (stopped) await stopped;
        return;
      }

      const [stopResult, clearResult] = await Promise.allSettled([
        Promise.resolve(stopped),
        Promise.race([
          bot.telegram.deleteMyCommands(),
          aborted(signal, bot).then(() => signal.throwIfAborted()),
        ]),
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

  function startTelegramBot(): TelegramPolling {
    const lifetime = bot
      ? bot.launch(() => logger("Telegram bot launched"))
      : Promise.reject(new Error("Telegram is not configured"));
    const finished = lifetime.then(
      () => true,
      (error) => {
        if (bot) logger("Telegram bot polling failed", error);
        return true;
      },
    );
    let stopping: Promise<void> | undefined;
    let shutdownPromise: Promise<void> | undefined;

    function stop(signal?: AbortSignal): Promise<void> {
      stopping ??= (async () => {
        if (!bot || (await Promise.race([finished, Promise.resolve(false)]))) {
          return;
        }
        const settled = lifetime.then(
          () => true,
          (error) => {
            logger(
              `Failed to stop the Telegram bot: ${formatUnknownError(error)}`,
            );
            return true;
          },
        );
        while (true) {
          try {
            bot.stop();
            break;
          } catch (error) {
            if (
              !(error instanceof Error) ||
              error.message !== "Bot is not running!"
            ) {
              logger(
                `Failed to stop the Telegram bot: ${formatUnknownError(error)}`,
              );
              return;
            }
            if (
              await Promise.race([
                setTimeout(100, false, { ref: false }),
                settled,
              ])
            ) {
              return;
            }
          }
        }
        await settled;
      })();
      return signal && bot
        ? Promise.race([stopping, aborted(signal, bot)])
        : stopping;
    }

    const polling: TelegramPolling = {
      lifetime,
      stop,
      shutdown: () => (shutdownPromise ??= shutdown(polling)),
    };
    return polling;
  }

  return {
    startTelegramBot,
    shutdownTelegramBot,
    requestOtpCode: createOtpHandler(bot),
  };
}

export type TelegramPolling = {
  lifetime: Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
  shutdown(): Promise<void>;
};
