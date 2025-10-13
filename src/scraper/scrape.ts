import {
  createScraper,
  ScraperOptions,
  ScraperScrapingResult,
} from "israeli-bank-scrapers";
import { AccountConfig } from "../types.js";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";
import { createLogger } from "../utils/logger.js";
import { prepareAccountCredentials } from "./otp.js";
import { editMessage, sendError } from "../bot/notifier.js";

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

    const accountCredentials = prepareAccountCredentials(account);
    const result = await scraper.scrape({
      ...account,
      ...accountCredentials,
    });

    if (result.success) {
      logger(`success: ${account.companyId}`);
    } else if (
      [
        ScraperErrorTypes.ChangePassword,
        ScraperErrorTypes.InvalidPassword,
        ScraperErrorTypes.AccountBlocked,
      ].includes(result.errorType!)
    ) {
      logger(`error: ${result.errorType} ${result.errorMessage}`);
    } else {
      logger(`error: ${result.errorType} ${result.errorMessage}`);

      const messageText = `Error scraping account ${account.companyId}: ${result.errorType} ${result.errorMessage}`;
      const [message, retryResult] = await Promise.all([
        sendError(`${messageText}\nretrying...`),
        scraper.scrape({ ...account, ...accountCredentials }),
      ]);

      if (!retryResult.success) {
        const error = `${retryResult.errorType} ${retryResult.errorMessage}`;
        logger(`retry error: ${error}`);
        await editMessage(
          message?.message_id,
          `${messageText}\nretry failed: ${error}`,
        );
      } else {
        logger(`retry succeeded: ${account.companyId}`);
        await editMessage(
          message?.message_id,
          `${messageText}\nretry succeeded`,
        );
        return retryResult;
      }
    }

    return result;
  } catch (e) {
    logger(e);
    return {
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: String(e),
    };
  } finally {
    logger(`ended`);
  }
}
