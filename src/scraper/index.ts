import { performance } from "perf_hooks";
import { getAccountTransactions } from "./scrape.js";
import { AccountConfig, AccountScrapeResult, ScraperConfig } from "../types.js";
import { createLogger } from "../utils/logger.js";
import { loggerContextStore } from "../utils/asyncContext.js";
import { createBrowser, createSecureBrowserContext } from "./browser.js";
import { getFailureScreenShotPath } from "../utils/failureScreenshot.js";
import { ScraperOptions } from "israeli-bank-scrapers";
import { parallelLimit } from "async";

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
  const companyGroups = new Map<
    string,
    Array<{ account: AccountConfig; index: number }>
  >();
  accounts.forEach((account, i) => {
    const group = companyGroups.get(account.companyId) ?? [];
    group.push({ account, index: i });
    companyGroups.set(account.companyId, group);
  });

  // Show initial "Waiting" status for queued same-company accounts
  for (const [, members] of companyGroups) {
    for (let j = 1; j < members.length; j++) {
      const { account, index } = members[j];
      status[index] = `[${account.companyId}] ⏳ Waiting`;
    }
  }
  if (companyGroups.size < accounts.length) {
    await scrapeStatusChanged?.(status);
  }

  const scrapeOne = async (account: AccountConfig, i: number) => {
    const { companyId } = account;
    return loggerContextStore.run(
      { prefix: `[#${i} ${companyId}]` },
      async () =>
        scrapeAccount(
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
        ),
    );
  };

  // Each company group is a single task that runs its accounts sequentially
  const groupTasks = [...companyGroups.entries()].map(
    ([, members]) =>
      async () => {
        const groupResults: AccountScrapeResult[] = [];
        for (let j = 0; j < members.length; j++) {
          const { account, index } = members[j];
          if (j > 0) {
            status[index] = `[${account.companyId}] ⏳ Waiting`;
            await scrapeStatusChanged?.(status);
          }
          groupResults.push(await scrapeOne(account, index));
        }
        return groupResults;
      },
  );

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
