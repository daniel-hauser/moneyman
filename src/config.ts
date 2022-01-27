import "dotenv/config";
import { subDays, format } from "date-fns";
import { AccountConfig } from "./types";

console.log("Parsing config");
const {
  DAYS_BACK,
  ACCOUNTS_JSON,
  TELEGRAM_API_KEY,
  TELEGRAM_CHAT_ID,
  GOOGLE_SHEET_ID,
  WORKSHEET_NAME,
  ACCOUNTS_TO_SCRAPE = "",
} = process.env;

/**
 * Add default values in case the value is falsy (0 is not valid here) or an empty string
 */
const daysBackToScrape = DAYS_BACK || 10;
const worksheetName = WORKSHEET_NAME || "_no_name";

const accountsToScrape = ACCOUNTS_TO_SCRAPE.split(",")
  .map((a) => a.trim())
  .filter(Boolean);

export {
  TELEGRAM_API_KEY,
  TELEGRAM_CHAT_ID,
  GOOGLE_SHEET_ID,
  worksheetName as WORKSHEET_NAME,
};
export const systemName = "moneyman";
export const currentDate = format(Date.now(), "yyyy-MM-dd");
export const scrapeStartDate = subDays(Date.now(), Number(daysBackToScrape));

export const accounts = parseAccounts(ACCOUNTS_JSON).filter(
  (account) =>
    accountsToScrape.length == 0 || accountsToScrape.includes(account.companyId)
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
];

function parseAccounts(accountsJson: string): Array<AccountConfig> {
  try {
    const parsed = JSON.parse(accountsJson);
    if (Array.isArray(parsed)) {
      // TODO: Add schema validations?
      return parsed as Array<AccountConfig>;
    }
  } catch {}

  throw new TypeError("ACCOUNTS_JSON must be a valid array");
}
