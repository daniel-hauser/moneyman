import { createScraper } from "israeli-bank-scrapers";
import { AccountConfig } from "../types.js";
import {
  ScaperScrapingResult,
  ScraperErrorTypes,
} from "israeli-bank-scrapers/lib/scrapers/base-scraper.js";

export async function getAccountTransactions(
  account: AccountConfig,
  startDate: Date
): Promise<ScaperScrapingResult> {
  console.log(`started`);
  try {
    const scraper = createScraper({
      startDate,
      companyId: account.companyId,
      args: ["--disable-dev-shm-usage"],
    });

    scraper.onProgress((progress) => {
      console.log(progress);
    });

    const result = await scraper.scrape(account);

    if (!result.success) {
      console.error(`error: ${result.errorType} ${result.errorMessage}`);
    }
    console.log(`ended`);

    return result;
  } catch (e) {
    console.error(e);
    return {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: String(e),
    };
  }
}
