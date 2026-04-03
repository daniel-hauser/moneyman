import { performance } from "perf_hooks";
import { getAccountTransactions } from "./scrape.js";
import { AccountConfig, AccountScrapeResult, ScraperConfig } from "../types.js";
import { createLogger } from "../utils/logger.js";
import { loggerContextStore } from "../utils/asyncContext.js";
import {
  createBrowser,
  createSecureBrowserContext,
  useKernelBrowser,
} from "./browser.js";
import { getFailureScreenShotPath } from "../utils/failureScreenshot.js";
import { ScraperOptions } from "israeli-bank-scrapers";
import { parallelLimit } from "async";
import type { Browser } from "puppeteer";

const logger = createLogger("scraper");

export const scraperOptions: Partial<ScraperOptions> = {
  navigationRetryCount: 3,
  viewportSize: { width: 1920, height: 1080 },
  optInFeatures: [
    "mizrahi:pendingIfHasGenericDescription",
    "mizrahi:pendingIfNoIdentifier",
    "mizrahi:pendingIfTodayTransaction",
    "isracard-amex:skipAdditionalTransactionInformation",
  ],
};

export async function scrapeAccounts(
  {
    accounts,
    startDate,
    futureMonthsToScrape,
    parallelScrapers,
    additionalTransactionInformation,
    includeRawTransaction,
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

  // Kernel cloud browsers use separate instances per company to avoid
  // same-bank fingerprint detection when scraping multiple accounts.
  // Local mode uses a single shared browser as before.
  const browsers = new Map<string, Browser>();
  const getBrowser = async (companyId: string): Promise<Browser> => {
    const key = useKernelBrowser ? companyId : "shared";
    let browser = browsers.get(key);
    if (!browser) {
      logger(`Creating browser for %s`, key);
      browser = await createBrowser();
      browsers.set(key, browser);
    }
    return browser;
  };

  const results = await parallelLimit<AccountConfig, AccountScrapeResult[]>(
    accounts.map((account, i) => async () => {
      const { companyId } = account;
      return loggerContextStore.run(
        { prefix: `[#${i} ${companyId}]` },
        async () => {
          const browser = await getBrowser(companyId);
          return scrapeAccount(
            account,
            {
              browserContext: await createSecureBrowserContext(
                browser,
                companyId,
              ),
              startDate,
              companyId,
              futureMonthsToScrape: futureMonths,
              storeFailureScreenShotPath: getFailureScreenShotPath(companyId),
              additionalTransactionInformation,
              includeRawTransaction,
              ...scraperOptions,
            },
            async (message, append = false) => {
              status[i] = append ? `${status[i]} ${message}` : message;
              return scrapeStatusChanged?.(status);
            },
          );
        },
      );
    }),
    Number(parallelScrapers),
  );
  const duration = (performance.now() - start) / 1000;
  logger(`scraping ended, total duration: ${duration.toFixed(1)}s`);
  await scrapeStatusChanged?.(status, duration);

  for (const browser of browsers.values()) {
    try {
      if (useKernelBrowser) {
        await browser.disconnect();
      } else {
        await browser.close();
      }
    } catch (e) {
      onError?.(e as Error, "browser.close");
      logger(`failed to close browser`, e);
    }
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
  account: AccountConfig,
  scraperOptions: ScraperOptions,
  setStatusMessage: (message: string, append?: boolean) => Promise<void>,
) {
  logger(`scraping started`);

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
