import {
  createScraper,
  ScraperOptions,
  ScraperScrapingResult,
} from "israeli-bank-scrapers";
import { AccountConfig } from "../types.js";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";
import { createLogger } from "../utils/logger.js";
import { prepareAccountCredentials, type OtpRequest } from "./otp.js";
import { isCloudflareBlock } from "./cloudflareSolver.js";
import { spanEvent } from "../utils/telemetry.js";
import { context, trace } from "@opentelemetry/api";

const logger = createLogger("scrape");

export async function getAccountTransactions(
  account: AccountConfig,
  options: ScraperOptions,
  onProgress: (companyId: string, status: string) => void,
  requestOtpCode?: OtpRequest,
): Promise<ScraperScrapingResult> {
  try {
    const scraper = createScraper(options);

    scraper.onProgress(
      context.bind(context.active(), (companyId, { type }) => {
        spanEvent("scraper.progress", {
          "account.company": companyId,
          step: type,
        });
        onProgress(companyId, type);
      }),
    );

    const result = await scraper.scrape({
      ...account,
      ...prepareAccountCredentials(account, requestOtpCode),
    });

    if (!result.success) {
      const errorMessage = result.errorMessage || "";
      if (isCloudflareBlock(errorMessage)) {
        logger(`Cloudflare block detected: ${result.errorType}`);
        return {
          success: false,
          errorType: ScraperErrorTypes.Generic,
          errorMessage: `CloudflareBlocked: ${errorMessage.substring(0, 200)}...`,
        };
      }
      logger(`error: ${result.errorType} ${result.errorMessage}`);
    }

    return result;
  } catch (e) {
    trace.getActiveSpan()?.recordException(e instanceof Error ? e : String(e));
    logger(e);
    const errorString = String(e);

    // Detect Cloudflare blocks in exceptions
    if (isCloudflareBlock(errorString)) {
      logger("Cloudflare block detected in exception");
      return {
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: `CloudflareBlocked: The scraper was blocked by Cloudflare. Try running from a different network/IP or wait before retrying.`,
      };
    }

    return {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: errorString,
    };
  }
}
