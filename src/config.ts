import "dotenv/config";
import { subDays } from "date-fns";
import { AccountConfig } from "./types";

const {
  DAYS_BACK,
  ACCOUNTS_JSON,
  TELEGRAM_API_KEY,
  TELEGRAM_CHAT_ID,
  GOOGLE_SHEET_ID,
  WORKSHEET_NAME,
} = process.env;

export { TELEGRAM_API_KEY, TELEGRAM_CHAT_ID, GOOGLE_SHEET_ID, WORKSHEET_NAME };
export const startDate = subDays(Date.now(), Number(DAYS_BACK));

export const accounts = JSON.parse(ACCOUNTS_JSON) as Array<AccountConfig>;

export const FileHeaders = [
  "date",
  "amount",
  "description",
  "memo",
  "_category", // Not used, but added to be backwards compatible with caspion
  "account",
  "hash",
];
