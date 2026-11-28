import { saveResults } from "./storage/index.js";
import { AccountScrapeResult, Runner, TransactionStorage } from "../types.js";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import {
  reportTransport,
  reportUpdateIntervalMs,
  sendPhotos,
} from "./notifier.js";
import { formatUnknownError } from "../utils/utils.js";
import { createReportPublisher } from "./reportPublisher.js";
import { createRunReport, type RunReport } from "./runReport.js";
import { readReportLogs } from "../utils/secure-log.js";
import { config } from "../config.js";
import { createScreenshotDataUrl } from "./screenshotDataUrl.js";

const logger = createLogger("bot");

export async function runWithStorage(
  runScraper: Runner,
  storages: readonly TransactionStorage[],
  publication: {
    report: RunReport;
    reportSent: boolean;
    logsSent?: boolean;
  } = { report: createRunReport(), reportSent: false },
): Promise<typeof publication> {
  const sendReportFile =
    Boolean(reportTransport) &&
    (config.options.notifications.telegram?.sendReportFileToTelegram ?? false);
  const sendFailureScreenshots =
    Boolean(reportTransport) &&
    (config.options.notifications.telegram?.sendFailureScreenshotsToTelegram ??
      false);
  const { report, finish } = createReportPublisher(publication.report, {
    transport: reportTransport,
    sendReportFile,
    intervalMs: reportUpdateIntervalMs,
  });
  publication.report = report;

  try {
    if (!storages.length) {
      logger("No storages found, aborting");
      report.notices.push("No storages found, aborting");
      return publication;
    }

    await runScraper({
      onTiming(timing) {
        const timings = (report.timings ??= []);
        const index = timings.findIndex(({ id }) => id === timing.id);
        if (index === -1) timings.push({ ...timing });
        else timings[index] = { ...timing };
      },
      async onStatusChanged(status: Array<string>, totalTime?: number) {
        logger(`scrape status: ${status.join(" | ")}`);
        report.scrape = { status, totalTimeSec: totalTime };
      },
      async onResultsReady(results: AccountScrapeResult[]) {
        logger(`scrape results ready (${results.length} results)`);
        report.summary = { results };
        const failedAccounts = results.filter(({ result }) => !result.success);
        if (failedAccounts.length) {
          report.failed = true;
          logger(
            `Accounts that failed: ${failedAccounts.map(({ companyId }) => companyId).join(", ")}`,
          );
        }
        await saveResults(results, report, storages);
      },
      async onError(e: unknown, caller: string = "unknown") {
        report.failed = true;
        report.errors.push({
          caller,
          message:
            e instanceof Error && e.stack
              ? `${e.message}\n${e.stack}`
              : formatUnknownError(e),
        });
      },
      async onBeforeStart() {},
      async failureScreenshotsHandler(photos) {
        if (sendFailureScreenshots && photos.length) {
          try {
            await sendPhotos(photos);
          } catch (e) {
            // Photo delivery is best-effort: a rejected upload must not stop
            // the report from embedding the same screenshots.
            logger(`Failed to send failure screenshots`, e);
          }
        }
        if (!reportTransport || !sendReportFile) return;
        report.screenshots.push(
          ...(await Promise.all(
            photos.map(async ({ photoPath, caption }) => ({
              caption,
              ...(await createScreenshotDataUrl(photoPath)),
            })),
          )),
        );
      },
    });

    logToPublicLog("Scraping ended", logger);
  } finally {
    report.endedAt = new Date();
    const logs = sendReportFile ? readReportLogs() : undefined;
    publication.reportSent = await finish(logs);
    publication.logsSent = publication.reportSent && logs !== undefined;
  }

  return publication;
}
