import { performance } from "perf_hooks";
import { getAccountTransactions } from "./scrape.js";
import { AccountConfig, AccountScrapeResult } from "../types.js";
import { createLogger } from "../utils/logger.js";
import { createBrowser } from "../browser.js";
import { send, sendError } from "../notifier.js";
import { getFailureScreenShotPath } from "../utils/failureScreenshot.js";
import { ScraperOptions } from "israeli-bank-scrapers";
import { parallelScrapers } from "../config.js";
import { parallelLimit } from "async";
import os from "node:os";

const logger = createLogger("scraper");

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

  let futureMonths: number | undefined = undefined;
  if (!Number.isNaN(futureMonthsToScrape)) {
    logger(`months to scrap: %d`, futureMonthsToScrape);
    futureMonths = futureMonthsToScrape;
  }

  const status: Array<string> = [];

  logger("Creating a browser");
  const browser = await createBrowser();
  logger(`Browser created, starting to scrape ${accounts.length} accounts`);

  if (Number(parallelScrapers) > 1) {
    logger(`Running with ${parallelScrapers} parallel scrapers`);
    send(
      `System info: ${JSON.stringify(
        {
          parallelScrapers: Number(parallelScrapers),
          availableParallelism: os.availableParallelism(),
          totalMemoryGB: (os.totalmem() / 1000000000).toFixed(2),
          freeMemoryGB: (os.freemem() / 1000000000).toFixed(2),
          cpus: os.cpus().length,
        },
        null,
        2,
      )}`,
    );
  }

  const results = await parallelLimit<AccountConfig, AccountScrapeResult[]>(
    accounts.map(
      (account, i) => async () =>
        scrapeAccount(
          logger.extend(`#${i} (${account.companyId})`),
          account,
          {
            browserContext: await browser.createBrowserContext(),
            startDate,
            companyId: account.companyId,
            futureMonthsToScrape: futureMonths,
            storeFailureScreenShotPath: getFailureScreenShotPath(
              account.companyId,
            ),
          },
          async (message, append = false) => {
            status[i] = append ? `${status[i]} ${message}` : message;
            return scrapeStatusChanged?.(status);
          },
        ),
    ),
    Number(parallelScrapers),
  );

  const duration = (performance.now() - start) / 1000;
  logger(`scraping ended, total duration: ${duration.toFixed(1)}s`);
  await scrapeStatusChanged?.(status, duration);

  try {
    logger(`closing browser`);
    await browser?.close();
  } catch (e) {
    sendError(e, "browser.close");
    logger(`failed to close browser`, e);
  }

  logger(getStats(results));
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

async function scrapeAccount(
  logger: debug.IDebugger,
  account: AccountConfig,
  scraperOptions: ScraperOptions,
  setStatusMessage: (message: string, append?: boolean) => Promise<void>,
) {
  logger(`scraping`);

  const scraperStart = performance.now();
  const result = await getAccountTransactions(
    account,
    scraperOptions,
    (cid, step) => setStatusMessage(`[${cid}] ${step}`),
  );

  const duration = (performance.now() - scraperStart) / 1000;
  logger(`scraping ended, took ${duration.toFixed(1)}s`);
  await setStatusMessage(`, took ${duration.toFixed(1)}s`, true);

  return {
    companyId: account.companyId,
    result,
  };
}
