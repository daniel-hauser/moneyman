import { createTask } from "node-cron";
import { addAbortListener } from "node:events";
import { config } from "./config.js";
import { createLogger, logToPublicLog } from "./utils/logger.js";
import {
  getTelegramBot,
  launchTelegramBot,
  shutdownTelegramBot,
  sendError,
} from "./bot/notifier.js";
import { registerCommands, type AccountChoice } from "./bot/commands.js";
import { accountId, accountLabels } from "./utils/accountLabel.js";
import type {
  AccountConfig,
  RunHandle,
  RunOptions,
  RunStatus,
  RunTrigger,
} from "./types.js";
import { aborted } from "node:util";
import type { ProcessHandlers } from "./utils/processErrors.js";

const logger = createLogger("server");

/** How long a shutdown waits for the scrape in progress before exiting anyway. */
const SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;

export type SecretRefreshResult = "refreshed" | "failed";

export type ServerRunner = {
  startRun(trigger: RunTrigger, options?: RunOptions): Promise<RunHandle>;
  refreshSecrets?: () => Promise<SecretRefreshResult>;
  isRunning(): Promise<boolean>;
  getLastRun(): RunStatus | undefined;
  /**
   * The accounts the provider currently offers. Read on every call, so a
   * secret refresh that changes the account set is reflected in the picker and
   * in the selection guard.
   */
  getAccounts(): Promise<Array<AccountConfig>>;
};

export async function startServer(
  {
    startRun,
    refreshSecrets,
    isRunning,
    getLastRun,
    getAccounts,
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

  async function startTrackedRun(
    trigger: RunTrigger,
    accountIds?: readonly string[],
  ) {
    const handle = await startRun(
      trigger,
      accountIds?.length ? { accountIds } : {},
    );
    if (handle.started) {
      activeRun = handle.finished
        .catch((error) => logger(`${trigger} run failed`, error))
        .finally(() => {
          activeRun = undefined;
        });
    }

    return handle;
  }

  /**
   * The accounts offered by `/scrape_provider`, in configuration order. Read
   * from the loaded config; a selection that no longer resolves is rejected
   * when the run starts, so a stale picker entry cannot scrape the wrong
   * account.
   */
  async function listAccounts(): Promise<Array<AccountChoice>> {
    // The same map a run gets, so a button and the run it starts agree
    const accounts = await getAccounts();
    const failed = new Set(getLastRun()?.failedAccountIds ?? []);
    return [...accountLabels(accounts)].map(([id, label]) => ({
      id,
      label,
      failedLastRun: failed.has(id),
    }));
  }

  const task = cron
    ? createTask(cron, () => {
        startTrackedRun("scheduled").catch((e) =>
          logger("Scheduled run failed", e),
        );
      })
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

  registerCommands(bot, {
    listAccounts,
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
    async scrape(accountIds?: readonly string[]) {
      if (shuttingDown) return "🛑 Shutting down, no new scrapes";
      if (accountIds?.length) {
        // Read the current accounts rather than the start-up set: a secret
        // refresh can remove the account the button was rendered for.
        const configured = new Set(
          (await getAccounts()).map((account) => accountId(account)),
        );
        if (!accountIds.some((id) => configured.has(id))) {
          return "❌ That account is no longer configured, run /scrape_provider again";
        }
      }

      const { started, finished } = await startTrackedRun("manual", accountIds);
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
