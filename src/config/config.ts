import "dotenv/config";
import { format, subDays } from "date-fns";
import { createLogger, logToPublicLog } from "../utils/logger.js";

const logger = createLogger("config");
logger("Parsing config");
logToPublicLog("Parsing config");

const {
  DAYS_BACK,
  ACCOUNTS_JSON,
  TELEGRAM_API_KEY: TELEGRAM_API_KEY_ENV = "",
  TELEGRAM_CHAT_ID: TELEGRAM_CHAT_ID_ENV = "",
  GOOGLE_SHEET_ID: GOOGLE_SHEET_ID_ENV = "",
  WORKSHEET_NAME,
  ACCOUNTS_TO_SCRAPE,
  FUTURE_MONTHS,
  YNAB_TOKEN: YNAB_TOKEN_ENV = "",
  YNAB_BUDGET_ID: YNAB_BUDGET_ID_ENV = "",
  YNAB_ACCOUNTS: YNAB_ACCOUNTS_ENV = "",
  BUXFER_USER_NAME: BUXFER_USER_NAME_ENV = "",
  BUXFER_PASSWORD: BUXFER_PASSWORD_ENV = "",
  BUXFER_ACCOUNTS: BUXFER_ACCOUNTS_ENV = "",
  TRANSACTION_HASH_TYPE: TRANSACTION_HASH_TYPE_ENV = "",
  WEB_POST_URL: WEB_POST_URL_ENV = "",
} = process.env;

export const TELEGRAM_API_KEY = TELEGRAM_API_KEY_ENV;
export const TELEGRAM_CHAT_ID = TELEGRAM_CHAT_ID_ENV;
export const GOOGLE_SHEET_ID = GOOGLE_SHEET_ID_ENV;
export const YNAB_TOKEN = YNAB_TOKEN_ENV;
export const YNAB_BUDGET_ID = YNAB_BUDGET_ID_ENV;
export const YNAB_ACCOUNTS = YNAB_ACCOUNTS_ENV;
export const BUXFER_USER_NAME = BUXFER_USER_NAME_ENV;
export const BUXFER_PASSWORD = BUXFER_PASSWORD_ENV;
export const BUXFER_ACCOUNTS = BUXFER_ACCOUNTS_ENV;
export const TRANSACTION_HASH_TYPE = TRANSACTION_HASH_TYPE_ENV;
export const WEB_POST_URL = WEB_POST_URL_ENV;

// Add default values in case the value is falsy (0 is not valid here) or an empty string
export const daysBackToScrape = DAYS_BACK || 10;
export const worksheetName = WORKSHEET_NAME || "_moneyman";
export const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const systemName = "moneyman";
export const currentDate = format(Date.now(), "yyyy-MM-dd");
export const scrapeStartDate = subDays(Date.now(), Number(daysBackToScrape));

function parseAccounts(accountsJson) {
  try {
    const parsed = JSON.parse(accountsJson);
    if (Array.isArray(parsed)) {
      // TODO: Add schema validations?
      return parsed;
    }
  } catch (error) {
    // Handle error if necessary
  }
  throw new TypeError("ACCOUNTS_JSON must be a valid array");
}

logger("Config parsed", {
  systemName,
  systemTimezone,
  scrapeStartDate,
  daysBackToScrape,
  worksheetName,
  TELEGRAM_CHAT_ID,
});

/** classifier config */
export type ClassificationOption = {
  name: string;
  emoji: string;
};

export const classificationOptions = [
  { name: "מזון וצריכה", emoji: "🍔" },
  { name: "תחבורה", emoji: "🚗" },
  { name: "רפואה וקוסמטיקה", emoji: "💊" },
  { name: "חשמל וגז", emoji: "💡" },
  { name: "כלבו", emoji: "🏬" },
  { name: "אלברט", emoji: "🐶" },
  { name: "מעבר דירה", emoji: "🚚" },
  { name: "מים", emoji: "💧" },
  { name: "תקשורת", emoji: "📡" },
  { name: "כושר", emoji: "💪" },
  { name: "אמזון", emoji: "📦" },
  { name: "ניקיון", emoji: "🧹" },
  { name: "בילויים", emoji: "🎉" },
  { name: "הלבשה והנעלה", emoji: "👗" },
  { name: "ציוד ביתי", emoji: "🏠" },
  { name: "מחשבים", emoji: "💻" },
  { name: "מתנות", emoji: "🎁" },
  { name: "עליאקספרס", emoji: "📦" },
  { name: "הריון", emoji: "🤰" },
  { name: "פנאי ובידור", emoji: "🎮" },
  { name: "צמחים", emoji: "🌱" },
  { name: "תיירות - אוכל", emoji: "✈️🍽️" },
  { name: "תיירות - אטרקציה", emoji: "✈️🎢" },
  { name: "תיירות - ביטוח", emoji: "✈️🛡️" },
  { name: "תיירות - טיסה", emoji: "✈️" },
  { name: "תיירות - לינה", emoji: "✈️🛏️" },
  { name: "תיירות - נסיעות", emoji: "✈️🚕" },
  { name: "תרומות", emoji: "💝" },
];

export const SHEET_NAMES = {
  TRANSACTIONS: "Sheet5",
  MAP: "map",
};

export const botTimeoutMinutes = 15; // Timeout duration in minutes
