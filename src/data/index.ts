import { performance } from "perf_hooks";
import { getAccountTransactions } from "./scrape.js";
import { AccountConfig, AccountScrapeResult } from "../types.js";
import { createLogger } from "../utils/logger.js";
import { createBrowser } from "../browser.js";
import { sendError } from "../notifier.js";
import { getFailureScreenShotPath } from "../utils/failureScreenshot.js";

const logger = createLogger("data");

export async function scrapeAccounts(
  accounts: Array<AccountConfig>,
  startDate: Date,
  futureMonthsToScrape: number,
  scrapeStatusChanged?: (
    status: Array<string>,
    totalTime?: number,
  ) => Promise<void>,
) {
  const start = performance.now();

  logger(`scraping %d accounts`, accounts.length);
  logger(`start date %s`, startDate.toISOString());
  if (!Number.isNaN(futureMonthsToScrape)) {
    logger(`months to scrap: %d`, futureMonthsToScrape);
  }

  const status: Array<string> = [];
  const results: Array<AccountScrapeResult> = [];

  logger("Creating a browser");
  const browser = await createBrowser();
  logger(`Browser created, starting to scrape ${accounts.length} accounts`);

  const defaultBrowserContext = browser?.defaultBrowserContext();

  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    const accountLogger = logger.extend(`#${i} (${account.companyId})`);

    accountLogger(`scraping account`);

    function setStatusMessage(message: string) {
      status[i] = message;
      return scrapeStatusChanged?.(status);
    }

    const scraperStart = performance.now();
    const result = await getAccountTransactions(
      account,
      {
        browserContext: defaultBrowserContext,
        startDate,
        companyId: account.companyId,
        futureMonthsToScrape: Number.isNaN(futureMonthsToScrape)
          ? undefined
          : futureMonthsToScrape,
        storeFailureScreenShotPath: getFailureScreenShotPath(account.companyId),
      },
      (cid, step) => setStatusMessage(`[${cid}] ${step}`),
    );

    const duration = (performance.now() - scraperStart) / 1000;
    accountLogger(`scraping ended, took ${duration.toFixed(1)}s`);
    await setStatusMessage(`${status[i]}, took ${duration.toFixed(1)}s`);

    results.push({
      companyId: account.companyId,
      result,
    });
  }

  const duration = (performance.now() - start) / 1000;
  logger(`scraping ended total duration: ${duration}s, got`, getStats(results));
  await scrapeStatusChanged?.(status, duration);

  try {
    logger(`closing browser`);
    await browser?.close();
  } catch (e) {
    sendError(e, "browser.close");
    logger(`failed to close browser`, e);
  }

  return results;
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
