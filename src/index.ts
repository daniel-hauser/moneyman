import { randomUUID } from "crypto";
import { locks } from "node:worker_threads";
import { scrapeAccounts } from "./scraper/client.js";
import {
  config,
  getScraperConfig,
  sendConfigToTelegramIfRequested,
} from "./config.js";
import { BooleanEnvVarSchema } from "./config.schema.js";
import {
  sendError,
  reportTransport,
  reportUpdateIntervalMs,
} from "./bot/notifier.js";
import { createLogger, logToPublicLog } from "./utils/logger.js";
import {
  sendLogFile,
  enableDebugLoggingIfNeeded,
  readReportLogs,
} from "./utils/secure-log.js";
import {
  RunHandle,
  RunOptions,
  RunnerHooks,
  RunStatus,
  RunTrigger,
} from "./types.js";
import type { AccountScrapeResult } from "./types.js";
import type { ScraperRunConfig } from "./scraper/protocol.js";
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
import { getBuildMetadata } from "./buildMetadata.js";
import { createRunReport } from "./bot/runReport.js";
import { createReportPublisher } from "./bot/reportPublisher.js";
import { formatUnknownError } from "./utils/utils.js";

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
logger("Build metadata", getBuildMetadata());
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
      await runOnce("startup", { signal: abort.signal });
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
  options: RunOptions = {},
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
      const outcome = await run(options);

      lastRun = {
        trigger,
        startedAt,
        endedAt: new Date(),
        failed: outcome.failed,
        failedAccountIds: outcome.failedAccountIds,
      };
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
  options: RunOptions = {},
): Promise<RunStatus> {
  const status = await (await startRun(trigger, options)).finished;

  if (!status) {
    throw new Error("A scrape is already in progress");
  }

  return status;
}

async function runScraper(
  hooks: RunnerHooks,
  scraperConfig: ScraperRunConfig,
  domainTracker: DomainTracker,
  options: RunOptions = {},
) {
  try {
    logger("About to start");
    await hooks.onBeforeStart();

    if (options.accountIds?.length && !scraperConfig.accounts.length) {
      // A selection that matches no configured account must fail loudly: an
      // empty scrape would otherwise look like a successful run.
      await hooks.onError(
        new Error("No configured account matches the requested scrape"),
        "scrape selection",
      );
      return;
    }

    logger("Starting to scrape");
    const { results, domains } = await scrapeAccounts(
      scraperConfig,
      async (status, totalTime) => {
        logger("Status changed", { status, totalTime });
        return hooks.onStatusChanged(status, totalTime);
      },
      async (e, caller) => {
        logger("Error while scraping", e);
        return hooks.onError(e, caller);
      },
      options.signal,
      hooks.onTiming,
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

type RunOutcome = {
  failed: boolean;
  /** Ids of the accounts that failed, so the next picker can mark them */
  failedAccountIds: readonly string[];
};

/** Ids of the accounts whose scrape failed, when the result carries one */
function failedAccountIds(
  results: Array<AccountScrapeResult> | undefined,
): readonly string[] {
  return (results ?? [])
    .filter(({ result }) => !result.success)
    .flatMap(({ accountId }) => (accountId ? [accountId] : []));
}

async function run(options: RunOptions = {}): Promise<RunOutcome> {
  let publication: Awaited<ReturnType<typeof runWithStorage>> = {
    report: createRunReport(),
    reportSent: false,
  };
  let report = publication.report;
  let prepared: Awaited<ReturnType<typeof prepareRun>>;
  try {
    prepared = await prepareRun();
    if (!prepared) {
      report.failed = true;
      report.errors.push({ caller: "Setup", message: "Run setup failed" });
      return { failed: true, failedAccountIds: [] };
    }
    const { snapshot, storages } = prepared;
    const scraperConfig = getScraperConfig(snapshot, options.accountIds);
    const domainTracker = createDomainTracker({
      domainTracking: snapshot.options.scraping.domainTracking,
      ...snapshot.options.security,
    });
    try {
      logger("Running with storage");
      publication = await runWithStorage(
        (hooks) => runScraper(hooks, scraperConfig, domainTracker, options),
        storages,
        publication,
      );
      report = publication.report;
    } finally {
      domainTracker.dispose();
    }
    const failedStorages = Object.entries(report.storages)
      .filter(([, row]) => row.state === "error")
      .map(([name]) => name);
    if (failedStorages.length) {
      logger(`Storages that failed: ${failedStorages.join(", ")}`);
    }
    return {
      failed: report.failed || failedStorages.length > 0,
      failedAccountIds: failedAccountIds(report.summary?.results),
    };
  } catch (error) {
    logger(error);
    report.failed = true;
    report.errors.push({ caller: "Run", message: formatUnknownError(error) });
    return { failed: true, failedAccountIds: [] };
  } finally {
    try {
      if (!report.endedAt) {
        report.endedAt = new Date();
        const sendReportFile =
          Boolean(reportTransport) &&
          (config.options.notifications.telegram?.sendReportFileToTelegram ??
            false);
        const logs = sendReportFile ? readReportLogs() : undefined;
        publication.reportSent = await createReportPublisher(report, {
          transport: reportTransport,
          sendReportFile,
          intervalMs: reportUpdateIntervalMs,
        }).finish(logs);
        publication.logsSent = publication.reportSent && logs !== undefined;
      }
    } finally {
      await sendLogFile(
        !longRunning,
        prepared?.storages ?? [],
        publication.logsSent,
      );
    }
  }
}
