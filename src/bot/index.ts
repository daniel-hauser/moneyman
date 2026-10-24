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
import { ReportPublisher } from "./reportPublisher.js";
import { createRunReport } from "./runReport.js";

const logger = createLogger("bot");

export async function runWithStorage(runScraper: Runner) {
  const publisher = new ReportPublisher(createRunReport(), {
    transport: reportTransport,
    intervalMs: reportUpdateIntervalMs,
  });
  publisher.update(() => {}, "Starting...");

  try {
    if (!storages.length) {
      publisher.update(
        (r) => r.notices.push("No storages found, aborting"),
        "No storages found, aborting",
      );
      return;
    }

    const runId = randomUUID();

    await runContextStore.run({ runId }, async () => {
      await runScraper({
        async onStatusChanged(status: Array<string>, totalTime?: number) {
          publisher.update(
            (r) => {
              r.scrape = { status, totalTimeSec: totalTime };
            },
            `scrape status: ${status.join(" | ")}${totalTime ? ` (total ${totalTime.toFixed(1)}s)` : ""}`,
          );
        },
        async onResultsReady(results: AccountScrapeResult[]) {
          publisher.update((r) => {
            r.summary = { results };
          }, `scrape results ready (${results.length} results)`);
          await saveResults(results, publisher);
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
    await publisher.finish();
  }
}
