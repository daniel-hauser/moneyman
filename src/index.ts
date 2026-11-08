import { randomUUID } from "crypto";
import { aborted } from "node:util";
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
  requestOtpCode,
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
import { registerProcessHandlers } from "./utils/processErrors.js";
import type { OtpRequest } from "./scraper/otp.js";
import { createOneShotOtpSession } from "./bot/otpSession.js";

const logger = createLogger("main");
const SCRAPE_LOCK = "moneyman-scrape";
const longRunning = BooleanEnvVarSchema.parse(
  process.env.MONEYMAN_LONG_RUNNING,
);
let lastRun: RunStatus | undefined;

console.log("Starting...");

const processHandlers = registerProcessHandlers({
  logger,
  notify: (message) => sendError(message),
  onFatal: () => {
    process.exitCode = 1;
  },
});

enableDebugLoggingIfNeeded();
logger("Build metadata", getBuildMetadata());
getExternalIp().then((ipInfo) => logger("External IP info:", ipInfo));
main();

async function main() {
  const configUpload = sendConfigToTelegramIfRequested();
  const completed = new AbortController();
  const uploadSignal = AbortSignal.any([
    processHandlers.signal,
    completed.signal,
  ]);
  try {
    await Promise.race([configUpload, aborted(uploadSignal, configUpload)]);
  } finally {
    completed.abort();
  }
  if (processHandlers.signal.aborted) {
    try {
      await processHandlers.waitForNotifications();
    } finally {
      processHandlers.dispose();
    }
    process.exit(process.exitCode ?? 0);
    return;
  }

  if (longRunning) {
    await startServer(
      {
        startRun,
        refreshSecrets: hasConfigSecretProvider() ? refreshSecrets : undefined,
        isRunning,
        getLastRun: () => lastRun,
      },
      processHandlers,
    );
  } else {
    try {
      await runOnce("startup", { signal: processHandlers.signal });
    } catch (error) {
      processHandlers.reportUnhandledRejection(error);
    } finally {
      try {
        await processHandlers.waitForNotifications();
      } finally {
        processHandlers.dispose();
      }
      // kill internal browsers if stuck
      process.exit(process.exitCode ?? 0);
    }
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
  requestOtp: OtpRequest,
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
      requestOtp,
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
  const otpSession = longRunning
    ? undefined
    : createOneShotOtpSession(options.signal);
  const requestOtp = otpSession?.request ?? requestOtpCode;
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
        (hooks) =>
          runScraper(hooks, scraperConfig, domainTracker, requestOtp, options),
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
    // The scrape may already have published its results before whatever threw
    // here (a cleanup, a report), and those failures are still the answer to
    // "what failed last run" — dropping them would leave the picker and
    // `/status` naming nothing.
    return {
      failed: true,
      failedAccountIds: failedAccountIds(report.summary?.results),
    };
  } finally {
    try {
      await otpSession?.close();
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
}
