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

let initialized = false;
let running: Promise<RunStatus> | undefined;
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
  return running !== undefined;
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
  if (running) {
    throw new Error("A scrape is already in progress");
  }

  const current = executeRun(trigger).finally(() => {
    running = undefined;
  });
  running = current;

  return await current;
}

async function executeRun(trigger: RunTrigger): Promise<RunStatus> {
  const startedAt = new Date();
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
    await runWithStorage(runScraper);
  } catch (error) {
    failed = true;
    logger(error);
  }

  await sendAndDeleteLogFile();

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
