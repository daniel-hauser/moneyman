import { scrapeAccounts } from "@moneyman/scraper";
import { scraperConfig } from "./config.ts";
import { sendError } from "./bot/notifier.ts";
import { createLogger } from "@moneyman/common";
import type { RunnerHooks } from "./types.ts";
import { runWithStorage } from "./bot/index.ts";
import { sendFailureScreenShots } from "@moneyman/common";
import { monitorNodeConnections } from "@moneyman/scraper";
import { reportRunMetadata } from "./runnerMetadata.ts";

const logger = createLogger("main");

process.on("uncaughtException", (err, origin) => {
  console.error("uncaughtException, sending error");
  sendError(`
Caught exception: ${err}
err.stack: ${err.stack}
Exception origin: ${origin}`).catch(() => {});
});

monitorNodeConnections();
await run();

// kill internal browsers if stuck
process.exit(0);

async function runScraper(hooks: RunnerHooks) {
  try {
    logger("About to start");
    await hooks.onBeforeStart();

    logger("Starting to scrape");
    const results = await scrapeAccounts(
      scraperConfig,
      async (status, totalTime) => {
        logger("Status changed", { status, totalTime });
        return hooks.onStatusChanged(status, totalTime);
      },
      async (e, caller) => {
        logger("Error while scraping", e);
        return hooks.onError(e, caller);
      },
    );
    logger("Scraping ended");
    await Promise.all([
      hooks.onResultsReady(results),
      sendFailureScreenShots(hooks.failureScreenshotsHandler),
    ]);

    await reportRunMetadata((metadata) => {
      logger("Reporting run metadata", metadata);
      return hooks.reportRunMetadata(metadata);
    });
  } catch (e) {
    logger("Error", e);
    await hooks.onError(e);
  }
}

async function run() {
  try {
    logger("Running with storage");
    await runWithStorage(runScraper);
  } catch (error) {
    logger(error);
  }
}
