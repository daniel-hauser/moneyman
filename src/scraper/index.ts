import { performance } from "perf_hooks";
import { getAccountTransactions } from "./scrape.js";
import { AccountConfig, AccountScrapeResult, ScraperConfig } from "../types.js";
import { createLogger } from "../utils/logger.js";
import { loggerContextStore } from "../utils/asyncContext.js";
import { createBrowser, createSecureBrowserContext } from "./browser.js";
import { getFailureScreenShotPath } from "../utils/failureScreenshot.js";
import { ScraperOptions } from "israeli-bank-scrapers";
import { parallelLimit } from "async";
import { setTimeout } from "timers/promises";

const SAME_COMPANY_DELAY_MS = 10_000;

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
  onError?: (e: unknown, caller: string) => void,
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

  // Group accounts by companyId so same-company accounts run sequentially
  // (they share a browser/IP and may conflict if run in parallel)
  const indexed = accounts.map((account, index) => ({ account, index }));
  const companyGroups = Object.groupBy(
    indexed,
    ({ account }) => account.companyId,
  );

  // Show initial "Waiting" status for queued same-company accounts
  for (const members of Object.values(companyGroups)) {
    members!.slice(1).forEach(({ account, index }) => {
      status[index] = `[${account.companyId}] ⏳ Waiting`;
    });
  }
  if (Object.keys(companyGroups).length < accounts.length) {
    await scrapeStatusChanged?.(status);
  }

  const scrapeOne = async (account: AccountConfig, i: number) => {
    const { companyId } = account;
    const browserContext = await createSecureBrowserContext(browser, companyId);
    return loggerContextStore.run(
      { prefix: `[#${i} ${companyId}]` },
      async () => {
        try {
          return await scrapeAccount(
            account,
            {
              browserContext,
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
        } finally {
          try {
            await browserContext.close();
          } catch (e) {
            logger(`failed to close browser context`, e);
          }
        }
      },
    );
  };

  // Each company group is a single task that runs its accounts sequentially
  const groupTasks = Object.values(companyGroups).map((members) => async () => {
    const groupResults: AccountScrapeResult[] = [];
    const [first, ...rest] = members!;
    groupResults.push(await scrapeOne(first.account, first.index));
    for (const { account, index } of rest) {
      status[index] = `[${account.companyId}] ⏳ Waiting`;
      await scrapeStatusChanged?.(status);
      await setTimeout(SAME_COMPANY_DELAY_MS);
      groupResults.push(await scrapeOne(account, index));
    }
    return groupResults;
  });

  const groupResults = await parallelLimit<
    (typeof groupTasks)[number],
    AccountScrapeResult[][]
  >(groupTasks, Number(parallelScrapers));

  const results = groupResults.flat();
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
