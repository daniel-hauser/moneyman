import { subDays } from "date-fns";
import { AccountConfig } from "../types.js";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import {
  TELEGRAM_API_KEY,
  TELEGRAM_CHAT_ID,
  GOOGLE_SHEET_ID,
  systemTimezone,
  systemName,
  currentDate,
} from "./SharedConfig.js";

const logger = createLogger("config");

logger("Parsing scrape config");
logToPublicLog("Parsing scrape config");

const {
  DAYS_BACK,
  ACCOUNTS_JSON,
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

export const daysBackToScrape = DAYS_BACK || 10;
export const worksheetName = WORKSHEET_NAME || "_moneyman";
export const futureMonthsToScrape = parseInt(FUTURE_MONTHS, 10);
export const scrapeStartDate = subDays(Date.now(), Number(daysBackToScrape));

const accountsToScrape = ACCOUNTS_TO_SCRAPE.split(",")
  .filter(Boolean)
  .map((a) => a.trim());

export const accounts = parseAccounts(ACCOUNTS_JSON).filter(
  (account) =>
    accountsToScrape.length === 0 ||
    accountsToScrape.includes(account.companyId),
);

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
  systemName,
  systemTimezone,
  currentDate,
};

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

logger("Scrape Config parsed", {
  systemName,
  systemTimezone,
  scrapeStartDate,
  daysBackToScrape,
  futureMonthsToScrape,
  worksheetName,
  TELEGRAM_CHAT_ID,
});
