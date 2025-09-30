import {
  createScraper,
  ScraperOptions,
  ScraperScrapingResult,
} from "israeli-bank-scrapers";
import { AccountConfig } from "../types.js";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";
import { createLogger } from "../utils/logger.js";
import { config } from "../config.js";
import { requestOtpCode } from "../bot/notifier.js";

const logger = createLogger("scrape");

/**
 * Creates an OTP code retriever function for OneZero accounts
 */
function createOtpCodeRetriever(
  companyId: string,
  phoneNumber: string,
): () => Promise<string> {
  return async () => {
    if (!config.options.notifications.telegram?.enableOtp) {
      throw new Error("OTP is not enabled in configuration");
    }

    logger(
      `Requesting OTP code for ${companyId} account (phone: ${phoneNumber.substring(0, 4)}...)`,
    );
    return await requestOtpCode(companyId, phoneNumber);
  };
}

/**
 * Prepares the account credentials with OTP support if needed
 */
function prepareAccountCredentials(account: AccountConfig): AccountConfig {
  // Check if this is a OneZero account that needs OTP
  if (
    account.companyId === "oneZero" &&
    config.options.notifications.telegram?.enableOtp &&
    "phoneNumber" in account &&
    account.phoneNumber &&
    !("otpLongTermToken" in account)
  ) {
    logger(`Setting up OTP code retriever for OneZero account`);

    return {
      ...account,
      otpCodeRetriever: createOtpCodeRetriever(
        account.companyId,
        account.phoneNumber,
      ),
    };
  }

  return account;
}

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

    // Prepare credentials with OTP support if needed
    const preparedAccount = prepareAccountCredentials(account);

    const result = await scraper.scrape(preparedAccount);

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
