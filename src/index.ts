import { scrapeAccounts } from "./data/index.js";
import { accounts, scrapeStartDate } from "./config.js";
import {
  send,
  getSummaryMessage,
  sendError,
  getConfigSummary,
} from "./notifier.js";
import { loadExistingHashes, saveResults } from "./storage/index.js";
import { createLogger } from "./utils/logger.js";

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
  console.log("scraping started");
  logger("scraping started");

  await send(getConfigSummary());

  const message = await send("Starting...");
  try {
    const [results] = await Promise.all([
      scrapeAccounts(accounts, scrapeStartDate, message?.message_id),
      loadExistingHashes(scrapeStartDate),
    ]);

    const saved = await saveResults(results);
    const summary = getSummaryMessage(results, saved.stats);

    await send(summary);
  } catch (e) {
    logger(e);
    await sendError(e);
  }

  logger("scraping ended");
  console.log("scraping ended");
}
