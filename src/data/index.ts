import { performance } from "perf_hooks";
import { getAccountTransactions } from "./scrape.js";
import { AccountConfig, AccountScrapeResult } from "../types";
import { editMessage } from "../notifier.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("data");

export async function scrapeAccounts(
  accounts: Array<AccountConfig>,
  startDate: Date,
  futureMonthsToScrape: number,
  statusMessageId?: number,
) {
  const start = performance.now();

  logger(`scraping %d accounts`, accounts.length);
  logger(`start date %s`, startDate.toISOString());
  if (!Number.isNaN(futureMonthsToScrape)) {
    logger(`months to scrap: %d`, futureMonthsToScrape);
  }

  const status: Array<string> = [];
  const results: Array<AccountScrapeResult> = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];

    logger(`scraping account #${i} (type=${account.companyId})`);
    const result = await scrapeAccount(
      account,
      startDate,
      futureMonthsToScrape,
      async (message) => {
        status[i] = message;
        await editMessage(statusMessageId, status.join("\n"));
      },
    );

    results.push({
      companyId: account.companyId,
      result,
    });
    logger(`scraping account #${i} ended`);
  }

  logger(`scraping ended`);
  const stats = getStats(results);
  logger(
    `Got ${stats.transactions} transactions from ${stats.accounts} accounts`,
  );

  const duration = (performance.now() - start) / 1000;
  logger(`total duration: ${duration}s`);

  await editMessage(
    statusMessageId,
    `${status.join("\n")}\n\ntotal time: ${duration.toFixed(1)}s`,
  );

  return results;
}

export async function scrapeAccount(
  account: AccountConfig,
  startDate: Date,
  futureMonthsToScrape: number,
  setStatusMessage: (message: string) => Promise<void>,
) {
  let message = "";
  const start = performance.now();
  const result = await getAccountTransactions(
    account,
    startDate,
    futureMonthsToScrape,
    (cid, step) => setStatusMessage((message = `[${cid}] ${step}`)),
  );

  const duration = (performance.now() - start) / 1000;
  logger(`scraping took ${duration.toFixed(1)}s`);
  await setStatusMessage(`${message}, took ${duration.toFixed(1)}s`);
  return result;
}

function getStats(results: Array<AccountScrapeResult>) {
  let accounts = 0;
  let transactions = 0;

  for (let { result } of results) {
    if (result.success) {
      accounts += result.accounts?.length ?? 0;
      for (let account of result.accounts ?? []) {
        transactions += account.txns?.length;
      }
    }
  }

  return {
    accounts,
    transactions,
  };
}
