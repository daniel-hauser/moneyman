import { scrapeAccounts } from "./data/index.js";
import {
  accounts,
  futureMonthsToScrape,
  scrapeStartDate,
} from "./config/AppConfig.js";
import { send, editMessage, sendError } from "./notifier.js";
import { saveResults, storages } from "./storage/index.js";
import { createLogger, logToPublicLog } from "./utils/logger.js";
import { getSummaryMessages } from "./messages.js";
import { sendFailureScreenShots } from "./utils/failureScreenshot.js";

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

  const message = await send("Starting...");

  if (!storages.length) {
    logger("No storages found, aborting");
    await editMessage(message?.message_id, "No storages found, aborting");
  } else {
    try {
      async function scrapeStatusChanged(
        status: Array<string>,
        totalTime?: number,
      ) {
        const text = status.join("\n");
        await editMessage(
          message?.message_id,
          totalTime
            ? text + `\n\nTotal time: ${totalTime.toFixed(1)} seconds`
            : text,
        );
      }

      const results = await scrapeAccounts(
        accounts,
        scrapeStartDate,
        futureMonthsToScrape,
        scrapeStatusChanged,
      );

      const summary = getSummaryMessages(results);
      await send(summary);

      logToPublicLog("Saving...");
      await saveResults(results);
      await sendFailureScreenShots();
    } catch (e) {
      logger(e);
      await sendError(e);
    }
  }

  logger("Scraping ended");
  logToPublicLog("Scraping ended");
}
