import { createScraper } from "israeli-bank-scrapers";
import {
  type ScraperOptions,
  type ScraperScrapingResult,
} from "israeli-bank-scrapers/lib/scrapers/interface.js";
import type { AccountConfig } from "./types.ts";
import { createLogger } from "@moneyman/common";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";

const logger = createLogger("scrape");

export async function getAccountTransactions(
  account: AccountConfig,
  options: ScraperOptions,
  onProgress: (companyId: string, status: string) => void,
): Promise<ScraperScrapingResult> {
  logger(`started`);
  try {
    const scraper = createScraper(options);

    scraper.onProgress((companyId, { type }) => {
      logger(`[${companyId}] ${type}`);
      onProgress(companyId, type);
    });

    const result = await scraper.scrape(account);

    if (!result.success) {
      logger(`error: ${result.errorType} ${result.errorMessage}`);
    }
    logger(`ended`);

    return result;
  } catch (e) {
    logger(e);
    return {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: String(e),
    };
  }
}
