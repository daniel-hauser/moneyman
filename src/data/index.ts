import { performance } from "perf_hooks";
import { getAccountTransactions } from "./scrape.js";
import { AccountConfig, AccountScrapeResult } from "../types";
import { Message } from "telegraf/typings/core/types/typegram";
import { editMessage } from "../notifier.js";

export async function scrapeAccounts(
  accounts: Array<AccountConfig>,
  startDate: Date,
  statusMessageId: number
) {
  const start = performance.now();

  console.log(
    `scraping started (accounts=${
      accounts.length
    }, startDate=${startDate.toISOString()})`
  );

  const status: Array<string> = [];
  const results: Array<AccountScrapeResult> = [];

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];

    console.group(`account #${i} (type=${account.companyId})`);
    const result = await scrapeAccount(account, startDate, async (message) => {
      status[i] = message;
      await editMessage(statusMessageId, status.join("\n"));
    });

    results.push({
      companyId: account.companyId,
      result,
    });

    console.groupEnd();
  }

  console.log(`scraping ended`);
  const stats = getStats(results);
  console.log(
    `Got ${stats.transactions} transactions from ${stats.accounts} accounts`
  );

  const duration = (performance.now() - start) / 1000;
  console.log(`total duration: ${duration}s`);

  await editMessage(
    statusMessageId,
    `${status.join("\n")}\n\ntotal time: ${duration.toFixed(1)}s`
  );

  return results;
}

export async function scrapeAccount(
  account: AccountConfig,
  startDate: Date,
  setStatusMessage: (message: string) => Promise<void>
) {
  let message = "";
  const start = performance.now();
  const result = await getAccountTransactions(account, startDate, (cid, step) =>
    setStatusMessage((message = `[${cid}] ${step}`))
  );

  const duration = (performance.now() - start) / 1000;
  await setStatusMessage(`${message}, took ${duration.toFixed(1)}s`);
  return result;
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
