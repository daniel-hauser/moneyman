import { scrapeAccounts } from "./data/index.js";
import { accounts, futureMonthsToScrape, scrapeStartDate } from "./config.js";
import {
  send,
  editMessage,
  getSummaryMessage,
  sendError,
  getConfigSummary,
} from "./notifier.js";
import { initializeStorage, saveResults, storages } from "./storage/index.js";
import { createLogger, logToPublicLog } from "./utils/logger.js";

const logger = createLogger("main");

process.on("uncaughtException", (err, origin) => {
  console.error("uncaughtException, sending error");
  sendError(`
Caught exception: ${err}
Exception origin: ${origin}`).catch((e) => {});
});

await run();

// kill internal browsers if stuck
process.exit(0);

async function run() {
  logToPublicLog("Scraping started");
  logger("Scraping started");

  await send(getConfigSummary());

  const message = await send("Starting...");

  if (!storages.length) {
    logger("No storages found, aborting");
    await editMessage(message?.message_id, "No storages found, aborting");
  } else {
    try {
      const [results] = await Promise.all([
        scrapeAccounts(
          accounts,
          scrapeStartDate,
          futureMonthsToScrape,
          message?.message_id,
        ),
        initializeStorage(),
      ]);

      const saved = await saveResults(results);
      const summary = getSummaryMessage(results, saved.stats);

      await send(summary);
    } catch (e) {
      logger(e);
      await sendError(e);
    }
  }

  logger("Scraping ended");
  logToPublicLog("Scraping ended");
}
