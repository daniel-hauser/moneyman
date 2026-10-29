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
import { createLogger, logToPublicLog } from "./utils/logger.js";
import { sendLogFile, enableDebugLoggingIfNeeded } from "./utils/secure-log.js";
import { RunHandle, RunnerHooks, RunStatus, RunTrigger } from "./types.js";
import { runWithStorage } from "./bot/index.js";
import { sendFailureScreenShots } from "./utils/failureScreenshot.js";
import { createDomainTracker, type DomainTracker } from "./security/domains.js";
import { getExternalIp, logRunMetadata } from "./runnerMetadata.js";
import { runContextStore } from "./utils/asyncContext.js";
import { startServer, type SecretRefreshResult } from "./server.js";
import {
  hasConfigSecretProvider,
  loadRunConfig,
  SECRET_REFRESH_FAILURE,
} from "./configRefresh.js";
import { createStorages } from "./bot/storage/index.js";
import type { MoneymanConfig } from "./config.js";

const logger = createLogger("main");
const SCRAPE_LOCK = "moneyman-scrape";
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
getExternalIp().then((ipInfo) => logger("External IP info:", ipInfo));
main();

async function main() {
  await sendConfigToTelegramIfRequested();

  if (longRunning) {
    await startServer({
      startRun,
      refreshSecrets: hasConfigSecretProvider() ? refreshSecrets : undefined,
      isRunning,
      getLastRun: () => lastRun,
    });
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
  return held.some((lock) => lock.name === SCRAPE_LOCK);
}

/**
 * Rejects duplicate scrapes. Resolves once the run starts, without waiting for
 * it to finish.
 */
async function startRun(
  trigger: RunTrigger,
  signal?: AbortSignal,
): Promise<RunHandle> {
  const { promise: started, resolve: reportStarted } =
    Promise.withResolvers<boolean>();

  const finished = locks.request(SCRAPE_LOCK, { ifAvailable: true }, (lock) => {
    if (!lock) {
      reportStarted(false);
      return undefined;
    }

    reportStarted(true);
    return runContextStore.run({ runId: randomUUID() }, async () => {
      const startedAt = new Date();
      const failed = await run(signal);

      lastRun = { trigger, startedAt, endedAt: new Date(), failed };
      logger("Run finished", lastRun);
      return lastRun;
    });
  });

  return { started: await started, finished };
}

async function refreshSecrets(): Promise<SecretRefreshResult> {
  try {
    await loadRunConfig();
    return "refreshed";
  } catch (error) {
    logger("Manual secret refresh failed", error);
    return "failed";
  }
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

async function runScraper(
  hooks: RunnerHooks,
  snapshot: MoneymanConfig,
  domainTracker: DomainTracker,
  signal?: AbortSignal,
) {
  try {
    logger("About to start");
    await hooks.onBeforeStart();

    logger("Starting to scrape");
    const { results, domains } = await scrapeAccounts(
      getScraperConfig(snapshot),
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

async function prepareRun() {
  try {
    let snapshot = config;
    if (longRunning) {
      try {
        snapshot = await loadRunConfig();
      } catch {
        logToPublicLog(SECRET_REFRESH_FAILURE);
        await sendError(new Error(SECRET_REFRESH_FAILURE), "Secrets refresh");
        return;
      }
    }
    return { snapshot, storages: createStorages(snapshot) };
  } catch (error) {
    logger(error);
  }
}

async function run(signal?: AbortSignal) {
  const prepared = await prepareRun();
  try {
    if (!prepared) return true;
    const { snapshot, storages } = prepared;
    const domainTracker = createDomainTracker({
      domainTracking: snapshot.options.scraping.domainTracking,
      ...snapshot.options.security,
    });
    let report;
    try {
      logger("Running with storage");
      report = await runWithStorage(
        (hooks) => runScraper(hooks, snapshot, domainTracker, signal),
        storages,
      );
    } finally {
      domainTracker.dispose();
    }
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
  } finally {
    await sendLogFile(!longRunning, prepared?.storages ?? []);
  }
}
