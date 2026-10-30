import { randomUUID } from "crypto";
import { locks } from "node:worker_threads";
import { scrapeAccounts } from "./scraper/client.js";
import {
  config,
  getScraperConfig,
  sendConfigToTelegramIfRequested,
} from "./config.js";
import { BooleanEnvVarSchema } from "./config.schema.js";
import { sendError } from "./bot/notifier.js";
import { createLogger } from "./utils/logger.js";
import { sendLogFile, enableDebugLoggingIfNeeded } from "./utils/secure-log.js";
import { RunHandle, RunnerHooks, RunStatus, RunTrigger } from "./types.js";
import { runWithStorage } from "./bot/index.js";
import { sendFailureScreenShots } from "./utils/failureScreenshot.js";
import { createDomainTracker } from "./security/domains.js";
import { getExternalIp, logRunMetadata } from "./runnerMetadata.js";
import { runContextStore } from "./utils/asyncContext.js";
import { startServer } from "./server.js";

const logger = createLogger("main");
const RUN_LOCK = "moneyman-run";
const longRunning = BooleanEnvVarSchema.parse(
  process.env.MONEYMAN_LONG_RUNNING,
);
let lastRun: RunStatus | undefined;

console.log("Starting...");

process.on("uncaughtException", (err, origin) => {
  console.error("uncaughtException, sending error");
  sendError(`
    Caught exception: ${err}
    err.stack: ${err.stack}
    Exception origin: ${origin}`).catch((e) => {});
});

enableDebugLoggingIfNeeded();
const domainTracker = createDomainTracker({
  domainTracking: config.options.scraping.domainTracking,
  ...config.options.security,
});
process.once("exit", domainTracker.dispose);
getExternalIp().then((ipInfo) => logger("External IP info:", ipInfo));
main();

async function main() {
  await sendConfigToTelegramIfRequested();

  if (longRunning) {
    await startServer({ startRun, isRunning, getLastRun: () => lastRun });
  } else {
    const abort = new AbortController();
    const cancel = () => abort.abort(new Error("Scraper worker cancelled"));
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    try {
      await runOnce("startup", abort.signal);
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }

    // kill internal browsers if stuck
    process.exit(0);
  }
}

async function isRunning() {
  const { held } = await locks.query();
  return held.some((lock) => lock.name === RUN_LOCK);
}

/**
 * Starts a run and resolves as soon as the run lock was decided, so a caller
 * can answer honestly before the scrape finishes. A call made while another run
 * holds the lock comes back with `started: false` instead of waiting for it.
 */
async function startRun(
  trigger: RunTrigger,
  signal?: AbortSignal,
): Promise<RunHandle> {
  let reportStarted!: (started: boolean) => void;
  const started = new Promise<boolean>((resolve) => {
    reportStarted = resolve;
  });

  const finished = locks.request(RUN_LOCK, { ifAvailable: true }, (lock) => {
    if (!lock) {
      reportStarted(false);
      return undefined;
    }

    reportStarted(true);
    return runContextStore.run({ runId: randomUUID() }, async () => {
      const startedAt = new Date();
      const failed = await run(signal);
      await sendLogFile(!longRunning);

      lastRun = { trigger, startedAt, endedAt: new Date(), failed };
      logger("Run finished", lastRun);
      return lastRun;
    });
  });

  return { started: await started, finished };
}

async function runOnce(
  trigger: RunTrigger,
  signal?: AbortSignal,
): Promise<RunStatus> {
  const status = await (await startRun(trigger, signal)).finished;

  if (!status) {
    throw new Error("A scrape is already in progress");
  }

  return status;
}

async function runScraper(hooks: RunnerHooks, signal?: AbortSignal) {
  try {
    logger("About to start");
    await hooks.onBeforeStart();

    logger("Starting to scrape");
    const { results, domains } = await scrapeAccounts(
      getScraperConfig(),
      async (status, totalTime) => {
        logger("Status changed", { status, totalTime });
        return hooks.onStatusChanged(status, totalTime);
      },
      async (e, caller) => {
        logger("Error while scraping", e);
        return hooks.onError(e, caller);
      },
      signal,
    );
    logger("Scraping ended");
    await Promise.all([
      hooks.onResultsReady(results),
      sendFailureScreenShots(hooks.failureScreenshotsHandler),
    ]);

    await logRunMetadata(await domainTracker.getUsedDomains(), domains);
  } catch (e) {
    logger("Error", e);
    await hooks.onError(e);
  }
}

async function run(signal?: AbortSignal) {
  try {
    logger("Running with storage");
    const report = await runWithStorage((hooks) => runScraper(hooks, signal));
    const failedStorages = Object.entries(report.storages)
      .filter(([, row]) => row.state === "error")
      .map(([name]) => name);
    if (failedStorages.length) {
      logger(`Storages that failed: ${failedStorages.join(", ")}`);
    }
    return report.failed || failedStorages.length > 0;
  } catch (error) {
    logger(error);
    return true;
  }
}
