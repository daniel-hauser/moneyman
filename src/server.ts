import { schedule } from "node-cron";
import { config } from "./config.js";
import { createLogger, logToPublicLog } from "./utils/logger.js";
import {
  getTelegramBot,
  launchTelegramBot,
  shutdownTelegramBot,
  sendError,
} from "./bot/notifier.js";
import { registerCommands } from "./bot/commands.js";
import type { RunHandle, RunStatus, RunTrigger } from "./types.js";
import { aborted } from "node:util";

const logger = createLogger("server");

/** How long a shutdown waits for the scrape in progress before exiting anyway. */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;

export type SecretRefreshResult = "refreshed" | "failed";

export type ServerRunner = {
  startRun(trigger: RunTrigger): Promise<RunHandle>;
  refreshSecrets?: () => Promise<SecretRefreshResult>;
  isRunning(): Promise<boolean>;
  getLastRun(): RunStatus | undefined;
};

export async function startServer({
  startRun,
  refreshSecrets,
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

  /** The run in progress, mirrored so a shutdown can wait for it. */
  let activeRun: Promise<unknown> | undefined;
  let shuttingDown = false;

  async function startTrackedRun(trigger: RunTrigger) {
    const handle = await startRun(trigger);
    if (handle.started) {
      activeRun = handle.finished
        .catch((error) => logger(`${trigger} run failed`, error))
        .finally(() => {
          activeRun = undefined;
        });
    }

    return handle;
  }

  const task = cron
    ? schedule(cron, () => {
        startTrackedRun("scheduled").catch((e) =>
          logger("Scheduled run failed", e),
        );
      })
    : undefined;
  logToPublicLog(
    cron
      ? `Scheduled runs: ${cron} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
      : "No scheduled runs, use /scrape in Telegram to run on demand",
  );

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger(`Received ${signal}, shutting down`);
    task?.stop();

    if (activeRun) {
      logToPublicLog("A scrape is in progress, waiting for it to finish");
      // The Telegram bot keeps polling while draining, so a scrape waiting for
      // an OTP can still receive it.
      const completed = new AbortController();
      const drainSignal = AbortSignal.any([
        AbortSignal.timeout(SHUTDOWN_DRAIN_TIMEOUT_MS),
        completed.signal,
      ]);
      const drained = await Promise.race([
        activeRun.then(() => true),
        aborted(drainSignal, activeRun).then(() => false),
      ]).finally(() => completed.abort());
      if (!drained) {
        logToPublicLog(
          `The scrape did not finish within ${SHUTDOWN_DRAIN_TIMEOUT_MS / 1000} seconds, shutting down anyway`,
        );
      }
    }

    await shutdownTelegramBot();

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
    refreshSecrets: refreshSecrets
      ? async () => {
          if (shuttingDown) return "🛑 Shutting down, no secret refresh";
          switch (await refreshSecrets()) {
            case "refreshed":
              return "✅ Secrets fetched and validated. No scrape started; the next scrape will refresh again. Telegram and scheduling changes require a restart.";
            case "failed":
              return "❌ Secret refresh failed. No scrape started. Check the private logs and provider access, then retry.";
          }
        }
      : undefined,
    async scrape() {
      if (shuttingDown) return "🛑 Shutting down, no new scrapes";

      const { started, finished } = await startTrackedRun("manual");
      if (!started) return "⏳ A scrape is already in progress";

      finished.catch(async (e) => {
        await sendError(e, "Manual scrape").catch((notificationError) =>
          logger("Failed to send manual scrape error", notificationError),
        );
      });

      return "🔄 Scrape started";
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
