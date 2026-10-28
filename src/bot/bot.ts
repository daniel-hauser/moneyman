import { Context, Telegraf } from "telegraf";
import { createLogger } from "../utils/logger.js";
import { formatUnknownError } from "../utils/utils.js";
import { createOtpHandler } from "./otp.js";

const logger = createLogger("bot");

export function createBot(bot: Telegraf<Context> | null) {
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

  const polling = {
    isTelegramBotRunning,
    launchTelegramBot,
    stopTelegramBot,
  };

  return { ...polling, requestOtpCode: createOtpHandler(bot, polling) };
}
