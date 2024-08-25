import "dotenv/config";
import { subDays, format } from "date-fns";
import { AccountConfig } from "../types.js";
import { createLogger, logToPublicLog } from "../utils/logger.js";

const logger = createLogger("config");

logger("Parsing config");
logToPublicLog("Parsing config");

const {
  DAYS_BACK,
  ACCOUNTS_JSON,
  TELEGRAM_API_KEY = "",
  TELEGRAM_CHAT_ID = "",
  GOOGLE_SHEET_ID = "",
  WORKSHEET_NAME,
  ACCOUNTS_TO_SCRAPE = "",
  FUTURE_MONTHS = "",
  YNAB_TOKEN = "",
  YNAB_BUDGET_ID = "",
  YNAB_ACCOUNTS = "",
  BUXFER_USER_NAME = "",
  BUXFER_PASSWORD = "",
  BUXFER_ACCOUNTS = "",
  TRANSACTION_HASH_TYPE = "",
  WEB_POST_URL = "",
} = process.env;

/**
 * Add default values in case the value is falsy (0 is not valid here) or an empty string
 */
export const daysBackToScrape = DAYS_BACK || 10;
export const worksheetName = WORKSHEET_NAME || "_moneyman";
export const futureMonthsToScrape = parseInt(FUTURE_MONTHS, 10);
export const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const accountsToScrape = ACCOUNTS_TO_SCRAPE.split(",")
  .filter(Boolean)
  .map((a) => a.trim());

export {
  TELEGRAM_API_KEY,
  TELEGRAM_CHAT_ID,
  GOOGLE_SHEET_ID,
  YNAB_TOKEN,
  YNAB_BUDGET_ID,
  YNAB_ACCOUNTS,
  BUXFER_USER_NAME,
  BUXFER_PASSWORD,
  BUXFER_ACCOUNTS,
  TRANSACTION_HASH_TYPE,
  WEB_POST_URL,
};
export const systemName = "moneyman";
export const currentDate = format(Date.now(), "yyyy-MM-dd");
export const scrapeStartDate = subDays(Date.now(), Number(daysBackToScrape));

export const accounts = parseAccounts(ACCOUNTS_JSON).filter(
  (account) =>
    accountsToScrape.length == 0 ||
    accountsToScrape.includes(account.companyId),
);

function parseAccounts(accountsJson?: string): Array<AccountConfig> {
  try {
    const parsed = JSON.parse(accountsJson!);
    if (Array.isArray(parsed)) {
      // TODO: Add schema validations?
      return parsed as Array<AccountConfig>;
    }
  } catch {}

  throw new TypeError("ACCOUNTS_JSON must be a valid array");
}

logger("Config parsed", {
  systemName,
  systemTimezone,
  scrapeStartDate,
  daysBackToScrape,
  futureMonthsToScrape,
  worksheetName,
  TELEGRAM_CHAT_ID,
});
