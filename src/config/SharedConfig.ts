import "dotenv/config";
import { format } from "date-fns";
import { createLogger, logToPublicLog } from "../utils/logger.js";

const logger = createLogger("config");

logger("Parsing shared config");
logToPublicLog("Parsing shared config");

export const TELEGRAM_API_KEY = process.env.TELEGRAM_API_KEY || "";
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
export const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || "";

export const systemName = "moneyman";
export const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const currentDate = format(Date.now(), "yyyy-MM-dd");

logger("Shared Config parsed", {
  systemName,
  systemTimezone,
  currentDate,
  TELEGRAM_CHAT_ID,
});
