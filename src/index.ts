import { randomUUID } from "crypto";
import { locks } from "node:worker_threads";
import { scrapeAccounts } from "./scraper/index.js";
import { getScraperConfig, sendConfigToTelegramIfRequested } from "./config.js";
import { BooleanEnvVarSchema } from "./config.schema.js";
import { sendError } from "./bot/notifier.js";
import { createLogger } from "./utils/logger.js";
import { sendLogFile, enableDebugLoggingIfNeeded } from "./utils/secure-log.js";
import { RunnerHooks, RunStatus, RunTrigger } from "./types.js";
import { runWithStorage } from "./bot/index.js";
import { sendFailureScreenShots } from "./utils/failureScreenshot.js";
import { monitorNodeConnections } from "./security/domains.js";
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
monitorNodeConnections();
getExternalIp().then((ipInfo) => logger("External IP info:", ipInfo));
main();

async function main() {
  await sendConfigToTelegramIfRequested();

  if (longRunning) {
    await startServer({ runOnce, isRunning, getLastRun: () => lastRun });
  } else {
    await runOnce("startup");

    // kill internal browsers if stuck
    process.exit(0);
  }
}

async function isRunning() {
  const { held } = await locks.query();
  return held.some((lock) => lock.name === RUN_LOCK);
}

async function runOnce(trigger: RunTrigger): Promise<RunStatus> {
  const result = await locks.request(
    RUN_LOCK,
    { ifAvailable: true },
    (lock) =>
      lock &&
      runContextStore.run({ runId: randomUUID() }, async () => {
        const startedAt = new Date();
        const failed = await run();
        await sendLogFile(!longRunning);

        lastRun = { trigger, startedAt, endedAt: new Date(), failed };
        logger("Run finished", lastRun);
        return lastRun;
      }),
  );

  if (!result) {
    throw new Error("A scrape is already in progress");
  }

  return result;
}

async function runScraper(hooks: RunnerHooks) {
  let failed = false;
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
    const failedAccounts = results.filter(({ result }) => !result.success);
    if (failedAccounts.length) {
      logger(
        `Accounts that failed: ${failedAccounts.map(({ companyId }) => companyId).join(", ")}`,
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

  return failed;
}

async function run() {
  let failed = false;
  try {
    logger("Running with storage");
    const report = await runWithStorage(async (hooks) => {
      failed = await runScraper(hooks);
    });
    const failedStorages = Object.entries(report.storages)
      .filter(([, row]) => row.state === "error")
      .map(([name]) => name);
    if (failedStorages.length) {
      logger(`Storages that failed: ${failedStorages.join(", ")}`);
      failed = true;
    }
  } catch (error) {
    logger(error);
    failed = true;
  }

  return failed;
}
