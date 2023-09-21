import "dotenv/config";
import { subDays, format } from "date-fns";
import { AccountConfig } from "./types";
import { logToPublicLog } from "./utils/logger.js";

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
} = process.env;

/**
 * Add default values in case the value is falsy (0 is not valid here) or an empty string
 */
export const daysBackToScrape = DAYS_BACK || 10;
export const worksheetName = WORKSHEET_NAME || "_moneyman";
export const futureMonthsToScrape = parseInt(FUTURE_MONTHS, 10);

const accountsToScrape = ACCOUNTS_TO_SCRAPE.split(",")
  .filter(Boolean)
  .map((a) => a.trim());

export { TELEGRAM_API_KEY, TELEGRAM_CHAT_ID, GOOGLE_SHEET_ID };
export const systemName = "moneyman";
export const currentDate = format(Date.now(), "yyyy-MM-dd");
export const scrapeStartDate = subDays(Date.now(), Number(daysBackToScrape));

export const accounts = parseAccounts(ACCOUNTS_JSON).filter(
  (account) =>
    accountsToScrape.length == 0 ||
    accountsToScrape.includes(account.companyId),
);

export const FileHeaders = [
  "date",
  "amount",
  "description",
  "memo",
  "category",
  "account",
  "hash",
  "comment",
  "scraped at",
  "scraped by",
  "identifier",
];

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
