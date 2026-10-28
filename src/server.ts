import { config } from "./config.js";
import { createLogger, logToPublicLog } from "./utils/logger.js";
import {
  getTelegramBot,
  launchTelegramBot,
  sendError,
  stopTelegramBot,
} from "./bot/notifier.js";
import { registerCommands } from "./bot/commands.js";
import { Scheduler } from "./scheduler.js";
import { getLastRun, initRunner, isRunning, runOnce } from "./runner.js";
import { assertLongRunningLogMode } from "./utils/secure-log.js";
import { formatUnknownError } from "./utils/utils.js";

const logger = createLogger("server");
const times = config.options.scheduling.times;

try {
  assertLongRunningLogMode();
} catch (error) {
  logToPublicLog(`❌ ${formatUnknownError(error)}`);
  logger(error);
  process.exit(1);
}

process.on("uncaughtException", (err, origin) => {
  console.error("uncaughtException, sending error");
  sendError(`
    Caught exception: ${err}
    err.stack: ${err.stack}
    Exception origin: ${origin}`).catch(() => {});
});

await initRunner();

const scheduler = new Scheduler(times, async () => {
  try {
    await runOnce("scheduled");
  } catch (e) {
    logger("Failed to start the scheduled run", e);
  }
});

/**
 * Start a run in the background and report back to the user immediately.
 * Progress and results are sent to the chat by the regular notification flow.
 */
async function scrape(): Promise<string> {
  if (isRunning()) {
    return "⚠️ A scrape is already running, please wait for it to finish";
  }

  runOnce("manual").catch((e) => logger("Manual run failed", e));
  return "🔄 Starting a scrape now...";
}

const bot = getTelegramBot();
if (!bot && !times.length) {
  logToPublicLog(
    "Nothing to do: no Telegram configuration and no options.scheduling.times. Exiting.",
  );
  process.exit(1);
}

scheduler.start();
logToPublicLog(
  times.length
    ? `Scheduled runs at: ${times.join(", ")} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
    : "No scheduled runs, use /scrape in Telegram to run on demand",
);

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger(`Received ${signal}, shutting down`);
  scheduler.stop();
  stopTelegramBot();

  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

if (bot) {
  registerCommands(bot, {
    scrape,
    isRunning,
    getLastRun,
    getNextRunAt: () => scheduler.nextRunAt,
  });

  await launchTelegramBot()
    .then(() => logToPublicLog("Listening for Telegram commands"))
    .catch((e) => {
      /**
       * The error of a failed launch can be a fetch error carrying the Telegram
       * API URL, which contains the bot token, and public logs are not
       * redacted. The details stay in the private log.
       */
      logToPublicLog(
        "❌ Failed to start the Telegram bot, see the logs for details",
      );
      logger(e);

      // Without Telegram there is nothing left to do unless runs are scheduled
      if (!times.length) process.exit(1);
    });
} else {
  logToPublicLog(
    "No Telegram configuration, moneyman will only run on schedule and will not accept commands",
  );
}
