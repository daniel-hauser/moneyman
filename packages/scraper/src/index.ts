import { performance } from "perf_hooks";
import type {
  AccountConfig,
  AccountScrapeResult,
  ScraperConfig,
} from "./types.ts";
import { createLogger, logToMetadataFile } from "@moneyman/common";
import { getAccountTransactions } from "./scrape.ts";
import { createBrowser, createSecureBrowserContext } from "./browser.ts";
import { getFailureScreenShotPath } from "./utils/failureScreenshot.ts";
import type { ScraperOptions } from "israeli-bank-scrapers";
import { parallelLimit } from "async";

export { getUsedDomains, monitorNodeConnections } from "./security/domains.ts";
export { createBrowser, createSecureBrowserContext };

const logger = createLogger("scraper");

export const scraperOptions: Partial<ScraperOptions> = {
  navigationRetryCount: 3,
  viewportSize: { width: 1920, height: 1080 },
};

export async function scrapeAccounts(
  {
    accounts,
    startDate,
    futureMonthsToScrape,
    parallelScrapers,
  }: ScraperConfig,
  scrapeStatusChanged?: (
    status: Array<string>,
    totalTime?: number,
  ) => Promise<void>,
  onError?: (e: Error, caller: string) => void,
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
  logToMetadataFile("Creating a browser");
  const browser = await createBrowser();
  logger(`Browser created, starting to scrape ${accounts.length} accounts`);

  const results = await parallelLimit<AccountConfig, AccountScrapeResult[]>(
    accounts.map((account, i) => async () => {
      const { companyId } = account;
      logToMetadataFile(`Scraping account #${i} (${companyId})`);
      return scrapeAccount(
        logger.extend(`#${i} (${companyId})`),
        account,
        {
          browserContext: await createSecureBrowserContext(browser, companyId),
          startDate,
          companyId,
          futureMonthsToScrape: futureMonths,
          storeFailureScreenShotPath: getFailureScreenShotPath(companyId),
          ...scraperOptions,
        },
        async (message, append = false) => {
          status[i] = append ? `${status[i]} ${message}` : message;
          return scrapeStatusChanged?.(status);
        },
      );
    }),
    Number(parallelScrapers),
  );
  logToMetadataFile("All accounts scraped");
  const duration = (performance.now() - start) / 1000;
  logger(`scraping ended, total duration: ${duration.toFixed(1)}s`);
  await scrapeStatusChanged?.(status, duration);

  try {
    logger(`closing browser`);
    await browser?.close();
  } catch (e) {
    onError?.(e, "browser.close");
    logger(`failed to close browser`, e);
  }

  logger(getStats(results));
  return results;
}

function getStats(results: Array<AccountScrapeResult>) {
  let accounts = 0;
  let transactions = 0;

  for (const { result } of results) {
    if (result.success) {
      accounts += result.accounts?.length ?? 0;
      for (const account of result.accounts ?? []) {
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
