import { scrapeAccounts } from "./data/index.js";
import { startDate, accounts } from "./config.js";
import { send, getSummaryMessage, sendError } from "./notifier.js";
import { loadExistingHashes, saveResults } from "./storage/index.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("main");

await run();

// kill internal browsers if stuck
process.exit(0);

async function run() {
  logger("scraping started");

  const { message_id } = await send("Starting...");
  try {
    const [results] = await Promise.all([
      scrapeAccounts(accounts, startDate, message_id),
      loadExistingHashes(startDate),
    ]);

    const saved = await saveResults(results);
    const summary = getSummaryMessage(startDate, results, saved.stats);

    await send(summary);
  } catch (e) {
    logger(e);
    await sendError(e);
  }

  logger("scraping ended");
}
