import { performance } from "perf_hooks";
import { getAccountTransactions } from "./scrape.js";
import { AccountConfig, AccountScrapeResult } from "../types";

export async function scrapeAccounts(
  accounts: Array<AccountConfig>,
  startDate: Date
) {
  const start = performance.now();

  console.log(
    `scraping started (accounts=${
      accounts.length
    }, startDate=${startDate.toISOString()})`
  );

  const results: Array<AccountScrapeResult> = [];
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const start = performance.now();

    console.group(`account #${i} (type=${account.companyId})`);

    results.push({
      companyId: account.companyId,
      result: await getAccountTransactions(account, startDate),
    });

    console.log(`duration: ${performance.now() - start}`);
    console.groupEnd();
  }

  console.log(`scraping ended`);
  const stats = getStats(results);
  console.log(
    `Got ${stats.transactions} transactions from ${stats.accounts} accounts`
  );
  console.log(`total duration: ${performance.now() - start}`);

  return results;
}
function getStats(results: Array<AccountScrapeResult>) {
  let accounts = 0;
  let transactions = 0;

  for (let { result } of results) {
    if (result.success) {
      accounts += result.accounts?.length;
      for (let account of result.accounts) {
        transactions += account.txns?.length;
      }
    }
  }

  return {
    accounts,
    transactions,
  };
}
