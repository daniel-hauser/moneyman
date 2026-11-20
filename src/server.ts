import { createTask } from "node-cron";
import { addAbortListener } from "node:events";
import { locks } from "node:worker_threads";
import { config } from "./config.js";
import { createLogger, logToPublicLog } from "./utils/logger.js";
import {
  getTelegramBot,
  launchTelegramBot,
  shutdownTelegramBot,
  sendError,
} from "./bot/notifier.js";
import { registerCommands, type CommandAvailability } from "./bot/commands.js";
import type { RunHandle, RunStatus, RunTrigger } from "./types.js";
import { aborted } from "node:util";
import type { ProcessHandlers } from "./utils/processErrors.js";
import { type ScrapeSelection } from "./selection.js";

const logger = createLogger("server");

/** How long a shutdown waits for the scrape in progress before exiting anyway. */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;

export type SecretRefreshResult = "refreshed" | "failed";

export type ServerRunner = {
  startRun(
    trigger: RunTrigger,
    selection?: ScrapeSelection,
    signal?: AbortSignal,
    /** Cancel setup, without cancelling an already-started scrape. */
    startSignal?: AbortSignal,
  ): Promise<RunHandle>;
  getCommandAvailability?: () => Promise<CommandAvailability>;
  refreshSecrets?: () => Promise<SecretRefreshResult>;
  isRunning(): Promise<boolean>;
  getLastRun(): RunStatus | undefined;
};

export async function startServer(
  {
    startRun,
    refreshSecrets,
    isRunning,
    getLastRun,
    getCommandAvailability,
  }: ServerRunner,
  processHandlers: ProcessHandlers,
) {
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
  const stateChanges = new EventTarget();
  const commandLifetime = new AbortController();

  async function startTrackedRun(
    trigger: RunTrigger,
    selection?: ScrapeSelection,
  ) {
    return locks.request(
      "moneyman-server-start",
      { mode: "shared" },
      async () => {
        if (commandLifetime.signal.aborted)
          return {
            started: false,
            error: "🛑 Shutting down, no new scrapes",
            finished: Promise.resolve(undefined),
          };
        // Only setup is cancelled: an already-started scrape must retain OTP polling.
        const handle = await startRun(
          trigger,
          selection,
          undefined,
          commandLifetime.signal,
        ).catch((error) => {
          stateChanges.dispatchEvent(new Event("stateChanged"));
          throw error;
        });
        if (handle.started) {
          activeRun = handle.finished
            .catch((error) => logger(`${trigger} run failed`, error))
            .finally(() => {
              activeRun = undefined;
              stateChanges.dispatchEvent(new Event("stateChanged"));
            });
        } else if (handle.error) {
          stateChanges.dispatchEvent(new Event("stateChanged"));
        }

        return handle;
      },
    );
  }

  const task = cron
    ? createTask(cron, () =>
        startTrackedRun("scheduled").catch((e) =>
          logger("Scheduled run failed", e),
        ),
      )
    : undefined;
  const signal = processHandlers.signal;
  function handleShutdownFailure(error: unknown) {
    process.exitCode = 1;
    try {
      logger("Failed to shut down cleanly", error);
    } finally {
      process.exit(1);
    }
  }

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    commandLifetime.abort();

    logger(`Received ${signal}, shutting down`);
    task?.stop();

    // Own pending setup before checking for a run; release the lock before the drain.
    const drain = locks
      .request("moneyman-server-start", () => undefined)
      .then(() => {
        if (activeRun)
          logToPublicLog("A scrape is in progress, waiting for it to finish");
        return activeRun;
      });
    // The Telegram bot keeps polling while draining, so a scrape waiting for
    // an OTP can still receive it.
    const completed = new AbortController();
    const drainSignal = AbortSignal.any([
      AbortSignal.timeout(SHUTDOWN_DRAIN_TIMEOUT_MS),
      completed.signal,
    ]);
    const drained = await Promise.race([
      drain.then(() => true),
      aborted(drainSignal, drain).then(() => false),
    ]).finally(() => completed.abort());
    if (!drained) {
      logToPublicLog(
        `The scrape did not finish within ${SHUTDOWN_DRAIN_TIMEOUT_MS / 1000} seconds, shutting down anyway`,
      );
    }

    try {
      await shutdownTelegramBot();
    } finally {
      try {
        await processHandlers.waitForNotifications();
      } finally {
        processHandlers.dispose();
      }
    }

    process.exit(process.exitCode ?? 0);
  }

  addAbortListener(signal, () => {
    void shutdown(processHandlers.reason ?? "process error").catch(
      handleShutdownFailure,
    );
  });

  try {
    signal.throwIfAborted();
    await task?.start();
    signal.throwIfAborted();
  } catch (error) {
    if (signal.aborted && error === signal.reason) return;
    throw error;
  }

  logToPublicLog(
    cron
      ? `Scheduled runs: ${cron} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
      : "No scheduled runs, use /scrape in Telegram to run on demand",
  );

  if (!bot) {
    logToPublicLog(
      "No Telegram configuration, moneyman will only run on schedule and will not accept commands",
    );
    return;
  }

  registerCommands(
    bot,
    {
      getCommandAvailability,
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
      async scrape(selection) {
        if (shuttingDown) return "🛑 Shutting down, no new scrapes";

        const { started, finished, error } = await startTrackedRun(
          "manual",
          selection,
        );
        if (!started) return error ?? "⏳ A scrape is already in progress";

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
    },
    {
      stateChanges,
      signal: commandLifetime.signal,
      chatId: config.options.notifications?.telegram?.chatId,
    },
  );

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
