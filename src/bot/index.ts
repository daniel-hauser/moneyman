import { saveResults, storages } from "./storage/index.js";
import { AccountScrapeResult, Runner } from "../types.js";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import {
  reportTransport,
  reportUpdateIntervalMs,
  sendError,
  sendPhotos,
} from "./notifier.js";
import { runContextStore } from "../utils/asyncContext.js";
import { createReportPublisher } from "./reportPublisher.js";
import { createRunReport, type RunReport } from "./runReport.js";

const logger = createLogger("bot");

/**
 * Run the scraper with the storages, inside the run context that carries the
 * run id. The id is owned by the caller (see `runOnce`) so that it survives
 * the run and can be handed to the log upload, which happens after this
 * context has ended.
 *
 * Returns the run report so the caller can tell whether a storage failed: a
 * storage error is caught here and recorded in the report rather than thrown.
 */
export async function runWithStorage(
  runScraper: Runner,
  runId: string,
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

    await runContextStore.run({ runId }, async () => {
      await runScraper({
        async onStatusChanged(status: Array<string>, totalTime?: number) {
          logger(`scrape status: ${status.join(" | ")}`);
          report.scrape = { status, totalTimeSec: totalTime };
        },
        async onResultsReady(results: AccountScrapeResult[]) {
          logger(`scrape results ready (${results.length} results)`);
          report.summary = { results };
          await saveResults(results, report);
        },
        async onError(e: unknown, caller: string = "unknown") {
          await sendError(e, caller);
        },
        async onBeforeStart() {},
        async failureScreenshotsHandler(photos) {
          await sendPhotos(photos);
        },
      });

      logToPublicLog("Scraping ended", logger);
    });
  } finally {
    await finish();
  }

  return report;
}
