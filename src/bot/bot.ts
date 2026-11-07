import { Context, Telegraf } from "telegraf";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import { aborted } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
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
  let botRunning = false;
  let launchPromise: Promise<void> | undefined;
  let startupPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let shutdownPromise: Promise<void> | undefined;

  function startTelegramBot(): Promise<void> {
    if (!bot) {
      return Promise.reject(new Error("Telegram is not configured"));
    }
    if (botRunning) return startupPromise ?? Promise.resolve();
    if (launchPromise) return startupPromise ?? Promise.resolve();

    botRunning = true;
    const started = Promise.withResolvers<void>();
    startupPromise = started.promise;
    let ready = false;
    const running = bot.launch(() => {
      ready = true;
      logger("Telegram bot launched");
      started.resolve();
    });
    launchPromise = running;
    void running.then(
      () => {
        botRunning = false;
        if (!ready) started.resolve();
      },
      (error) => {
        botRunning = false;
        if (ready) logger("Telegram bot polling failed", error);
        else started.reject(error);
      },
    );
    void running.then(
      () => {
        if (launchPromise === running) launchPromise = undefined;
      },
      () => {
        if (launchPromise === running) launchPromise = undefined;
      },
    );
    void started.promise.then(
      () => {
        if (startupPromise === started.promise) startupPromise = undefined;
      },
      () => {
        if (startupPromise === started.promise) startupPromise = undefined;
      },
    );
    return started.promise;
  }

  function launchTelegramBot(): Promise<void> {
    if (!bot) {
      return Promise.reject(new Error("Telegram is not configured"));
    }
    const started = startTelegramBot();
    const running = launchPromise;
    return started.then(() => running);
  }

  function stopTelegramBot(signal?: AbortSignal): Promise<void> | undefined {
    if (!bot || !botRunning) {
      return signal && stopPromise
        ? Promise.race([stopPromise, aborted(signal, bot)])
        : stopPromise;
    }
    botRunning = false;
    const running = launchPromise;
    if (!running) return;

    const stopping = (async () => {
      const settled = running.catch((error) =>
        logger(`Failed to stop the Telegram bot: ${formatUnknownError(error)}`),
      );
      while (launchPromise === running) {
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
          await Promise.race([delay(100, undefined, { ref: false }), settled]);
        }
      }
      await settled;
    })();
    stopPromise = stopping;
    void stopping.then(
      () => {
        if (stopPromise === stopping) stopPromise = undefined;
      },
      () => {
        if (stopPromise === stopping) stopPromise = undefined;
      },
    );
    return signal ? Promise.race([stopping, aborted(signal, bot)]) : stopping;
  }

  function shutdownTelegramBot(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      const completed = new AbortController();
      const signal = AbortSignal.any([
        AbortSignal.timeout(3_000),
        completed.signal,
      ]);
      try {
        const stopped = stopTelegramBot(signal);
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
    })();
    return shutdownPromise;
  }

  return {
    startTelegramBot,
    launchTelegramBot,
    stopTelegramBot,
    shutdownTelegramBot,
    requestOtpCode: createOtpHandler(bot),
  };
}
