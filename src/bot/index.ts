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
import { randomUUID } from "crypto";
import { createReportPublisher } from "./reportPublisher.js";
import { createRunReport } from "./runReport.js";

const logger = createLogger("bot");

export async function runWithStorage(runScraper: Runner) {
  const { report, finish } = createReportPublisher(createRunReport(), {
    transport: reportTransport,
    intervalMs: reportUpdateIntervalMs,
  });

  try {
    if (!storages.length) {
      logger("No storages found, aborting");
      report.notices.push("No storages found, aborting");
      return;
    }

    const runId = randomUUID();

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
}
