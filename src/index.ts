import { scrapeAccounts } from "./data/index.js";
import { startDate, accounts } from "./config.js";
import {
  send,
  getSummaryMessage,
  deleteMessage,
  sendError,
} from "./notifier.js";
import { loadExistingHashes, saveResults } from "./storage/index.js";

await run();

// kill internal browsers if stuck
process.exit(0);

async function run() {
  const message = await send("Updating...");

  try {
    const [results] = await Promise.all([
      scrapeAccounts(accounts, startDate),
      loadExistingHashes(startDate),
    ]);

    const saved = await saveResults(results);
    const summary = getSummaryMessage(results, saved.stats);

    await deleteMessage(message);
    await send(summary);
  } catch (e) {
    await sendError(e);
  }
}
