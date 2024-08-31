import "dotenv/config";
import { format, subDays } from "date-fns";
import { createLogger, logToPublicLog } from "../utils/logger.js";

const logger = createLogger("config");

logger("Parsing consolidated config");
logToPublicLog("Parsing consolidated config");

// Unified Configurations
export const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY || "";
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
export const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
export const TRANSACTION_HASH_TYPE = process.env.TRANSACTION_HASH_TYPE || "";
export const WORKSHEET_NAME = process.env.WORKSHEET_NAME || "_moneyman";
export const systemName = "moneyman";
export const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const currentDate = format(Date.now(), "yyyy-MM-dd");

const {
  DAYS_BACK,
  ACCOUNTS_JSON,
  ACCOUNTS_TO_SCRAPE = "",
  FUTURE_MONTHS = "",
  YNAB_TOKEN = "",
  YNAB_BUDGET_ID = "",
  YNAB_ACCOUNTS = "",
  BUXFER_USER_NAME = "",
  BUXFER_PASSWORD = "",
  BUXFER_ACCOUNTS = "",
  WEB_POST_URL = "",
} = process.env;

export const daysBackToScrape = DAYS_BACK || 10;
export const futureMonthsToScrape = parseInt(FUTURE_MONTHS, 10);
export const scrapeStartDate = subDays(Date.now(), Number(daysBackToScrape));

const accountsToScrape = ACCOUNTS_TO_SCRAPE.split(",")
  .filter(Boolean)
  .map((a) => a.trim());

export const accounts = JSON.parse(ACCOUNTS_JSON || "[]").filter(
  (account) =>
    !accountsToScrape.length || accountsToScrape.includes(account.companyId),
);
export type ClassificationOption = {
  name: string;
  emoji: string;
};
export const botTimeoutMinutes = 15;

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

export {
  YNAB_TOKEN,
  YNAB_BUDGET_ID,
  YNAB_ACCOUNTS,
  BUXFER_USER_NAME,
  BUXFER_PASSWORD,
  BUXFER_ACCOUNTS,
  WEB_POST_URL,
};

logger("Config parsed", {
  systemName,
  systemTimezone,
  currentDate,
  TELEGRAM_CHAT_ID,
});
