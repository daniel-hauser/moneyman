/// <reference lib="esnext.disposable" />
import { performance } from "perf_hooks";
import { getAccountTransactions } from "./scrape.js";
import { AccountConfig, AccountScrapeResult, ScraperConfig } from "../types.js";
import { createLogger } from "../utils/logger.js";
import { loggerContextStore } from "../utils/asyncContext.js";
import { createBrowser, createSecureBrowserContext } from "./browser.js";
import { getFailureScreenShotPath } from "../utils/failureScreenshot.js";
import { ScraperOptions } from "israeli-bank-scrapers";
import { parallelLimit } from "async";
import type { OtpRequest } from "./otp.js";
import type { DomainTracker } from "../security/domains.js";
import { aborted } from "node:util";

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
  initDomainTracking: DomainTracker["initDomainTracking"],
  scrapeStatusChanged?: (
    status: Array<string>,
    totalTime?: number,
  ) => Promise<void>,
  onError?: (e: unknown, caller: string) => void | Promise<void>,
  runtime: {
    executablePath?: string;
    requestOtpCode?: OtpRequest;
    signal?: AbortSignal;
  } = {},
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
  runtime.signal?.throwIfAborted();
  const browser = await createBrowser(runtime.executablePath, runtime.signal);
  try {
    runtime.signal?.throwIfAborted();
    logger(`Browser created, starting to scrape ${accounts.length} accounts`);
    const results = await parallelLimit<AccountConfig, AccountScrapeResult[]>(
      accounts.map((account, i) => async () => {
        runtime.signal?.throwIfAborted();
        const { companyId } = account;
        return loggerContextStore.run(
          { prefix: `[#${i} ${companyId}]` },
          async () =>
            scrapeAccount(
              account,
              {
                // Safe to remove when israeli-bank-scrapers upgrades to puppeteer 25+
                browserContext: (await createSecureBrowserContext(
                  browser,
                  companyId,
                  initDomainTracking,
                )) as any,
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
              runtime.requestOtpCode,
            ),
        );
      }),
      Number(parallelScrapers),
    );
    const duration = (performance.now() - start) / 1000;
    logger(`scraping ended, total duration: ${duration.toFixed(1)}s`);
    await scrapeStatusChanged?.(status, duration);
    runtime.signal?.throwIfAborted();

    logger(getStats(results));
    return results;
  } finally {
    logger("closing browser");
    try {
      await browser[Symbol.asyncDispose]();
    } catch (error) {
      logger("failed to close browser", error);
      const completed = new AbortController();
      const warningDeadline = AbortSignal.any([
        AbortSignal.timeout(3_000),
        completed.signal,
      ]);
      try {
        await Promise.race([
          onError?.(error, "browser.close"),
          aborted(warningDeadline, browser).then(() => {
            throw warningDeadline.reason;
          }),
        ]);
      } catch (notificationError) {
        logger("failed to report browser close failure", notificationError);
      } finally {
        completed.abort();
      }
    }
  }
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
  requestOtpCode?: OtpRequest,
) {
  logger(`scraping started`);

  const scraperStart = performance.now();
  const result = await getAccountTransactions(
    account,
    scraperOptions,
    (cid, step) => setStatusMessage(`[${cid}] ${step}`),
    requestOtpCode,
  );

  const duration = (performance.now() - scraperStart) / 1000;
  logger(`scraping ended, took ${duration.toFixed(1)}s`);
  await setStatusMessage(`, took ${duration.toFixed(1)}s`, true);

  return {
    companyId: account.companyId,
    result,
  };
}
