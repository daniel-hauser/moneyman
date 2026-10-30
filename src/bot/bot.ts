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

  function isTelegramBotRunning(): boolean {
    return botRunning;
  }

  async function launchTelegramBot(): Promise<void> {
    if (!bot) {
      throw new Error("Telegram is not configured");
    }
    if (botRunning) return;

    botRunning = true;
    try {
      await bot.launch(() => logger("Telegram bot launched"));
    } catch (e) {
      botRunning = false;
      throw e;
    }
  }

  function stopTelegramBot() {
    if (!bot || !botRunning) return;
    botRunning = false;
    try {
      bot.stop();
    } catch (e) {
      // Telegraf can still be starting when a shutdown signal arrives.
      logger(`Failed to stop the Telegram bot: ${formatUnknownError(e)}`);
    }
  }

  async function shutdownTelegramBot() {
    stopTelegramBot();
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
  }

  const polling = {
    isTelegramBotRunning,
    launchTelegramBot,
    stopTelegramBot,
  };

  return {
    ...polling,
    shutdownTelegramBot,
    requestOtpCode: createOtpHandler(bot, polling),
  };
}
