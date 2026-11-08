import { randomUUID } from "crypto";
import { aborted } from "node:util";
import { locks } from "node:worker_threads";
import { scrapeAccounts } from "./scraper/client.js";
import {
  config,
  getScraperConfig,
  getAccounts,
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
import { getBuildMetadata } from "./buildMetadata.js";
import { createRunReport } from "./bot/runReport.js";
import { createReportPublisher } from "./bot/reportPublisher.js";
import { formatUnknownError } from "./utils/utils.js";
import { registerProcessHandlers } from "./utils/processErrors.js";
import type { OtpRequest } from "./scraper/otp.js";
import { createOneShotOtpSession } from "./bot/otpSession.js";
import type { ScraperRunConfig } from "./scraper/protocol.js";
import {
  retryChoices,
  selectionChoices,
  type ScrapeSelection,
  type FailedLogin,
} from "./selection.js";

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
        getCommandAvailability: async () => {
          const scrapeIds = selectionChoices(
            getAccounts(await loadRunConfig()),
          );
          return {
            scrapeIds,
            scrapeFailed:
              retryChoices(lastRun?.failedLogins, scrapeIds).length > 0,
          };
        },
      },
      processHandlers,
    );
  } else {
    try {
      await runOnce("startup", processHandlers.signal);
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
  selection?: ScrapeSelection,
  signal?: AbortSignal,
  startSignal = signal,
): Promise<RunHandle> {
  const {
    promise: started,
    resolve: reportStarted,
    reject: rejectStart,
  } = Promise.withResolvers<Omit<RunHandle, "finished">>();

  const finished = locks.request(
    SCRAPE_LOCK,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) {
        reportStarted({ started: false });
        return undefined;
      }

      const start = (selected?: {
        snapshot: MoneymanConfig;
        scraperConfig: ScraperRunConfig;
      }) => {
        if (startSignal?.aborted) {
          reportStarted({
            started: false,
            error: "🛑 Shutting down, no new scrapes",
          });
          return undefined;
        }
        reportStarted({ started: true });
        return runContextStore.run({ runId: randomUUID() }, async () => {
          const startedAt = new Date();
          let outcome: Awaited<ReturnType<typeof run>> | undefined;
          let failed = true;
          try {
            {
              await using cleanup = new AsyncDisposableStack();
              outcome = await run(cleanup, signal, selected);
            }
            failed = outcome.failed;
          } finally {
            lastRun = {
              trigger,
              startedAt,
              endedAt: new Date(),
              failed,
              failedLogins: outcome?.failedLogins ?? [],
            };
            logger("Run finished", lastRun);
          }
          return lastRun;
        });
      };

      if (!selection || startSignal?.aborted) return start();
      try {
        const snapshot = await loadRunConfig();
        if (startSignal?.aborted) return start();
        const retrying = "retryFailed" in selection;
        const choices = retrying
          ? retryChoices(
              lastRun?.failedLogins,
              selectionChoices(getAccounts(snapshot)),
            )
          : selection.choices;
        if (retrying && !choices.length) {
          reportStarted({
            started: false,
            error: lastRun
              ? "No eligible failed logins to retry."
              : "No completed scrape to retry.",
          });
          return undefined;
        }
        const scraperConfig = getScraperConfig(snapshot, choices);
        if (!scraperConfig.accounts.length) {
          reportStarted({
            started: false,
            error: "No selected accounts available.",
          });
          return undefined;
        }
        return start({
          snapshot,
          scraperConfig,
        });
      } catch (error) {
        rejectStart(error);
        return undefined;
      }
    },
  );

  return { ...(await started), finished };
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
  const status = await (await startRun(trigger, undefined, signal)).finished;

  if (!status) {
    throw new Error("A scrape is already in progress");
  }

  return status;
}

async function runScraper(
  hooks: RunnerHooks,
  scraperSettings: ScraperRunConfig,
  domainTracker: DomainTracker,
  requestOtp: OtpRequest,
  signal?: AbortSignal,
) {
  try {
    logger("About to start");
    await hooks.onBeforeStart();

    logger("Starting to scrape");
    const { results, domains } = await scrapeAccounts(
      scraperSettings,
      requestOtp,
      async (status, totalTime) => {
        logger("Status changed", { status, totalTime });
        return hooks.onStatusChanged(status, totalTime);
      },
      async (e, caller) => {
        logger("Error while scraping", e);
        return hooks.onError(e, caller);
      },
      signal,
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

async function prepareRun(selected?: {
  snapshot: MoneymanConfig;
  scraperConfig: ScraperRunConfig;
}) {
  try {
    let snapshot = selected?.snapshot ?? config;
    if (longRunning && !selected) {
      try {
        snapshot = await loadRunConfig();
      } catch {
        logToPublicLog(SECRET_REFRESH_FAILURE);
        await sendError(new Error(SECRET_REFRESH_FAILURE), "Secrets refresh");
        return;
      }
    }
    const scraperConfig = selected?.scraperConfig ?? getScraperConfig(snapshot);
    return { snapshot, scraperConfig, storages: createStorages(snapshot) };
  } catch (error) {
    logger(error);
  }
}

async function run(
  cleanup: AsyncDisposableStack,
  signal?: AbortSignal,
  selected?: { snapshot: MoneymanConfig; scraperConfig: ScraperRunConfig },
) {
  const otpSession = longRunning ? undefined : createOneShotOtpSession(signal);
  const requestOtp = otpSession?.request ?? requestOtpCode;
  let publication: Awaited<ReturnType<typeof runWithStorage>> = {
    report: createRunReport(),
    reportSent: false,
  };
  let report = publication.report;
  let prepared: Awaited<ReturnType<typeof prepareRun>>;
  cleanup.defer(async () => {
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
  });
  try {
    prepared = await prepareRun(selected);
    if (!prepared) {
      report.failed = true;
      report.errors.push({ caller: "Setup", message: "Run setup failed" });
    } else {
      const { snapshot, scraperConfig, storages } = prepared;
      const domainTracker = createDomainTracker({
        domainTracking: snapshot.options.scraping.domainTracking,
        ...snapshot.options.security,
      });
      try {
        logger("Running with storage");
        publication = await runWithStorage(
          (hooks) =>
            runScraper(hooks, scraperConfig, domainTracker, requestOtp, signal),
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
      report.failed ||= failedStorages.length > 0;
    }
  } catch (error) {
    logger(error);
    report.failed = true;
    report.errors.push({ caller: "Run", message: formatUnknownError(error) });
  }
  return {
    failed: report.failed,
    failedLogins: (publication.report.summary?.results ?? [])
      .filter(({ result }) => !result.success)
      .map(({ companyId, scrapeId }): FailedLogin => ({ companyId, scrapeId })),
  };
}
