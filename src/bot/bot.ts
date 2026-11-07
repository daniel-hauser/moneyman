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
  let botRunning = false;
  let launchPromise: Promise<void> | undefined;
  let serverOwnsPolling = false;
  let otpPollingLeases = 0;
  let shutdownPromise: Promise<void> | undefined;

  function isTelegramBotRunning(): boolean {
    return botRunning;
  }

  function ensureTelegramBotLaunched(): Promise<void> {
    if (!bot) {
      return Promise.reject(new Error("Telegram is not configured"));
    }
    if (launchPromise) return launchPromise;
    if (botRunning) return Promise.resolve();

    botRunning = true;
    const starting = bot
      .launch(() => logger("Telegram bot launched"))
      .catch((e) => {
        botRunning = false;
        throw e;
      });
    launchPromise = starting;
    void starting.then(
      () => {
        if (launchPromise === starting) launchPromise = undefined;
      },
      () => {
        if (launchPromise === starting) launchPromise = undefined;
      },
    );
    return starting;
  }

  async function launchTelegramBot(): Promise<void> {
    serverOwnsPolling = true;
    try {
      await ensureTelegramBotLaunched();
    } catch (e) {
      serverOwnsPolling = false;
      throw e;
    }
  }

  function stopPolling() {
    if (!bot || !botRunning) return;
    botRunning = false;
    try {
      bot.stop();
    } catch (e) {
      // Telegraf can still be starting when a shutdown signal arrives.
      logger(`Failed to stop the Telegram bot: ${formatUnknownError(e)}`);
    }
  }

  function stopPollingIfUnowned() {
    if (!serverOwnsPolling && otpPollingLeases === 0) {
      stopPolling();
    }
  }

  function acquireOtpPolling() {
    otpPollingLeases++;
    let released = false;

    return {
      started: ensureTelegramBotLaunched(),
      release() {
        if (released) return;
        released = true;
        otpPollingLeases--;
        stopPollingIfUnowned();
      },
    };
  }

  function stopTelegramBot() {
    serverOwnsPolling = false;
    stopPollingIfUnowned();
  }

  function shutdownTelegramBot(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      serverOwnsPolling = false;
      stopPolling();
      if (!bot) return;

      const completed = new AbortController();
      const signal = AbortSignal.any([
        AbortSignal.timeout(3_000),
        completed.signal,
      ]);
      try {
        const cleared = await Promise.race([
          bot.telegram.deleteMyCommands(),
          aborted(signal, bot),
        ]);
        if (cleared !== true) signal.throwIfAborted();
      } catch (error) {
        logger("Failed to clear Telegram command menu", error);
        logToPublicLog("Failed to clear Telegram command menu", logger);
      } finally {
        completed.abort();
      }
    })();
    return shutdownPromise;
  }

  const polling = {
    isTelegramBotRunning,
    acquireOtpPolling,
    launchTelegramBot,
    stopTelegramBot,
  };

  return {
    ...polling,
    shutdownTelegramBot,
    requestOtpCode: createOtpHandler(bot, polling),
  };
}
