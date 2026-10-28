import { schedule } from "node-cron";
import { config } from "./config.js";
import { createLogger, logToPublicLog } from "./utils/logger.js";
import {
  getTelegramBot,
  launchTelegramBot,
  stopTelegramBot,
  sendError,
} from "./bot/notifier.js";
import { registerCommands } from "./bot/commands.js";
import type { RunStatus, RunTrigger } from "./types.js";

const logger = createLogger("server");

export type ServerRunner = {
  runOnce(trigger: RunTrigger): Promise<RunStatus>;
  isRunning(): Promise<boolean>;
  getLastRun(): RunStatus | undefined;
};

export async function startServer({
  runOnce,
  isRunning,
  getLastRun,
}: ServerRunner) {
  const cron = config.options.scheduling.cron;
  const bot = getTelegramBot();
  if (!bot && !cron) {
    logToPublicLog(
      "Nothing to do: no Telegram configuration and no options.scheduling.cron. Exiting.",
    );
    process.exit(1);
    return;
  }

  const task = cron
    ? schedule(cron, () =>
        runOnce("scheduled").catch((e) => logger("Scheduled run failed", e)),
      )
    : undefined;
  logToPublicLog(
    cron
      ? `Scheduled runs: ${cron} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
      : "No scheduled runs, use /scrape in Telegram to run on demand",
  );

  let shuttingDown = false;
  function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger(`Received ${signal}, shutting down`);
    task?.stop();
    stopTelegramBot();

    process.exit(0);
  }

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  if (!bot) {
    logToPublicLog(
      "No Telegram configuration, moneyman will only run on schedule and will not accept commands",
    );
    return;
  }

  registerCommands(bot, {
    async scrape() {
      runOnce("manual").catch(async (e) => {
        logger("Manual run failed", e);
        await sendError(e, "Manual scrape").catch((notificationError) =>
          logger("Failed to send manual scrape error", notificationError),
        );
      });

      return "🔄 Scrape requested";
    },
    isRunning,
    getLastRun,
    getNextRunAt: () => task?.getNextRun() ?? undefined,
  });

  await launchTelegramBot()
    .then(() => logToPublicLog("Listening for Telegram commands"))
    .catch((e) => {
      // Telegram fetch errors can contain the bot token; keep details out of public logs.
      logToPublicLog(
        "❌ Failed to start the Telegram bot, see the logs for details",
      );
      logger(e);

      if (!cron) process.exit(1);
    });
}
