/// <reference lib="esnext.disposable" />
import { performance } from "perf_hooks";
import { getAccountTransactions } from "./scrape.js";
import { AccountConfig, AccountScrapeResult, ScraperConfig } from "../types.js";
import { createLogger } from "../utils/logger.js";
import { createBrowser, createSecureBrowserContext } from "./browser.js";
import { getFailureScreenShotPath } from "../utils/failureScreenshot.js";
import { ScraperOptions } from "israeli-bank-scrapers";
import { parallelLimit } from "async";
import type { OtpRequest } from "./otp.js";
import type { DomainTracker } from "../security/domains.js";
import { aborted } from "node:util";
import { randomUUID } from "node:crypto";
import type { RunTiming, RunnerHooks } from "../types.js";
import { spanEvent } from "../utils/telemetry.js";
import { SpanStatusCode, trace } from "@opentelemetry/api";

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
    onTiming?: RunnerHooks["onTiming"];
  } = {},
) {
  const start = performance.now();

  trace.getActiveSpan()?.setAttributes({
    "account.count": accounts.length,
    "scraper.start_date": startDate.toISOString(),
    "scraper.future_months": futureMonthsToScrape,
  });

  let futureMonths: number | undefined = undefined;
  if (!Number.isNaN(futureMonthsToScrape)) {
    futureMonths = futureMonthsToScrape;
  }

  const status: Array<string> = [];

  runtime.signal?.throwIfAborted();
  const browser = await createBrowser(runtime.executablePath, runtime.signal);
  try {
    runtime.signal?.throwIfAborted();
    spanEvent("browser.ready");
    const results = await parallelLimit<AccountConfig, AccountScrapeResult[]>(
      accounts.map((account, i) => async () => {
        runtime.signal?.throwIfAborted();
        const { companyId } = account;
        const timing: RunTiming = {
          id: `scraper-${randomUUID()}`,
          kind: "scraper",
          name: companyId,
          startedAt: Date.now(),
        };
        return logger.span(
          {
            name: "account",
            attributes: { "account.index": i, "account.company": companyId },
          },
          async (span) => {
            try {
              await runtime.onTiming?.({ ...timing });
              const result = await scrapeAccount(
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
                  storeFailureScreenShotPath:
                    getFailureScreenShotPath(companyId),
                  additionalTransactionInformation,
                  includeRawTransaction,
                  ...scraperOptions,
                },
                async (message, append = false) => {
                  status[i] = append ? `${status[i]} ${message}` : message;
                  return scrapeStatusChanged?.(status);
                },
                runtime.requestOtpCode,
              );
              timing.failed = !result.result.success;
              if (timing.failed) {
                span.setStatus({ code: SpanStatusCode.ERROR });
                span.setAttributes({
                  "scraper.error_type": result.result.errorType,
                  "scraper.error_message": result.result.errorMessage,
                });
              }
              const stats = getStats([result]);
              span.setAttributes({
                "account.count": stats.accounts,
                "transaction.count": stats.transactions,
              });
              return result;
            } catch (error) {
              timing.failed = true;
              throw error;
            } finally {
              timing.endedAt = Date.now();
              await runtime.onTiming?.({ ...timing });
            }
          },
        );
      }),
      Number(parallelScrapers),
    );
    const duration = (performance.now() - start) / 1000;
    await scrapeStatusChanged?.(status, duration);
    runtime.signal?.throwIfAborted();

    const stats = getStats(results);
    spanEvent("scraper.completed", {
      "account.count": stats.accounts,
      "transaction.count": stats.transactions,
    });
    return results;
  } finally {
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
  const scraperStart = performance.now();
  const result = await getAccountTransactions(
    account,
    scraperOptions,
    (cid, step) => setStatusMessage(`[${cid}] ${step}`),
    requestOtpCode,
  );

  const duration = (performance.now() - scraperStart) / 1000;
  await setStatusMessage(`, took ${duration.toFixed(1)}s`, true);

  return {
    companyId: account.companyId,
    result,
  };
}
