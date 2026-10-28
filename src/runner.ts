import { getScraperConfig, sendConfigToTelegramIfRequested } from "./config.js";
import { scrapeAccounts } from "./scraper/index.js";
import { createLogger } from "./utils/logger.js";
import {
  sendAndDeleteLogFile,
  enableDebugLoggingIfNeeded,
} from "./utils/secure-log.js";
import { RunnerHooks } from "./types.js";
import { runWithStorage } from "./bot/index.js";
import { sendFailureScreenShots } from "./utils/failureScreenshot.js";
import { monitorNodeConnections } from "./security/domains.js";
import { getExternalIp, logRunMetadata } from "./runnerMetadata.js";
import { randomUUID } from "crypto";
import { locks } from "node:worker_threads";

const logger = createLogger("runner");

export type RunResult = {
  startedAt: Date;
  endedAt: Date;
  /**
   * `true` if any error was reported while scraping or saving.
   * Note that a single failing account still fails the whole run.
   */
  failed: boolean;
};

/** Information about the last completed run, used by the `/status` command */
export type RunStatus = RunResult & { trigger: RunTrigger };

export type RunTrigger = "manual" | "scheduled" | "startup";

/**
 * The lock that keeps a single run in flight. The lock manager owns the mutual
 * exclusion, so a second caller is rejected even if it comes from another
 * thread; `running` only mirrors it for the synchronous `isRunning()`.
 */
const RUN_LOCK = "moneyman-run";

let initialized = false;
let running = false;
let lastRun: RunStatus | undefined;

/**
 * One time process initialization, shared by the one shot and the long running
 * entrypoints. Safe to call more than once.
 */
export async function initRunner(): Promise<void> {
  if (initialized) return;
  initialized = true;

  enableDebugLoggingIfNeeded();
  monitorNodeConnections();
  getExternalIp().then((ipInfo) => logger("External IP info:", ipInfo));
  await sendConfigToTelegramIfRequested();
}

export function isRunning(): boolean {
  return running;
}

export function getLastRun(): RunStatus | undefined {
  return lastRun;
}

/**
 * Run the scraper once.
 *
 * Only one run can be in flight at a time: a concurrent call rejects instead of
 * starting a second browser and a second set of logins.
 */
export async function runOnce(trigger: RunTrigger): Promise<RunStatus> {
  const result = await locks.request(
    RUN_LOCK,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return undefined;

      running = true;
      try {
        return await executeRun(trigger);
      } finally {
        running = false;
      }
    },
  );

  if (!result) {
    throw new Error("A scrape is already in progress");
  }

  return result;
}

async function executeRun(trigger: RunTrigger): Promise<RunStatus> {
  const startedAt = new Date();
  /** Owned here so that it outlives the run context and reaches the log upload */
  const runId = randomUUID();
  let failed = false;

  const runScraper = async (hooks: RunnerHooks) => {
    try {
      logger("About to start");
      await hooks.onBeforeStart();

      logger("Starting to scrape");
      const results = await scrapeAccounts(
        getScraperConfig(),
        async (status, totalTime) => {
          logger("Status changed", { status, totalTime });
          return hooks.onStatusChanged(status, totalTime);
        },
        async (e, caller) => {
          logger("Error while scraping", e);
          failed = true;
          return hooks.onError(e, caller);
        },
      );
      /**
       * An account that fails to scrape (a wrong password, an OTP timeout)
       * comes back as `success: false` instead of throwing, so the results
       * have to be inspected for the run to be reported as failed.
       */
      const failedAccounts = results.filter(({ result }) => !result.success);
      if (failedAccounts.length) {
        logger(
          `${failedAccounts.length} of ${results.length} accounts failed: ${failedAccounts
            .map(({ companyId }) => companyId)
            .join(", ")}`,
        );
        failed = true;
      }

      logger("Scraping ended");
      await Promise.all([
        hooks.onResultsReady(results),
        sendFailureScreenShots(hooks.failureScreenshotsHandler),
      ]);

      await logRunMetadata();
    } catch (e) {
      logger("Error", e);
      failed = true;
      await hooks.onError(e);
    }
  };

  try {
    logger("Running with storage");
    const report = await runWithStorage(runScraper, runId);

    /**
     * A storage error is caught and recorded in the report rather than thrown,
     * so the run has to read it back to report the failure.
     */
    const failedStorages = Object.entries(report.storages)
      .filter(([, row]) => row.state === "error")
      .map(([name]) => name);
    if (failedStorages.length) {
      logger(`Storages that failed: ${failedStorages.join(", ")}`);
      failed = true;
    }
  } catch (error) {
    failed = true;
    logger(error);
  }

  await sendAndDeleteLogFile(runId);

  const result: RunStatus = {
    trigger,
    startedAt,
    endedAt: new Date(),
    failed,
  };
  lastRun = result;

  logger("Run finished", result);
  return result;
}
