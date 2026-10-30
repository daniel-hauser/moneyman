import { saveResults } from "./storage/index.js";
import { AccountScrapeResult, Runner, TransactionStorage } from "../types.js";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import { readFile } from "node:fs/promises";
import { reportTransport, reportUpdateIntervalMs } from "./notifier.js";
import { formatUnknownError } from "../utils/utils.js";
import { createReportPublisher } from "./reportPublisher.js";
import { createRunReport, type RunReport } from "./runReport.js";
import { readReportLogs } from "../utils/secure-log.js";

const logger = createLogger("bot");

export async function runWithStorage(
  runScraper: Runner,
  storages: readonly TransactionStorage[],
): Promise<RunReport> {
  const { report, finish } = createReportPublisher(createRunReport(), {
    transport: reportTransport,
    intervalMs: reportUpdateIntervalMs,
  });

  try {
    if (!storages.length) {
      logger("No storages found, aborting");
      report.notices.push("No storages found, aborting");
      return report;
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
        if (!reportTransport) return;
        report.screenshots.push(
          ...(await Promise.all(
            photos.map(async ({ photoPath, caption }) => ({
              caption,
              dataUrl: `data:image/png;base64,${(await readFile(photoPath)).toString("base64")}`,
            })),
          )),
        );
      },
    });

    logToPublicLog("Scraping ended", logger);
  } finally {
    report.endedAt = new Date();
    await finish(readReportLogs());
  }

  return report;
}
