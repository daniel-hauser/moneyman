import "dotenv/config";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import { classificationOptions, SHEET_NAMES } from "./ClassifyConfig.js";
import { daysBackToScrape, scrapeStartDate, accounts } from "./ScrapeConfig.js";
import {
  TELEGRAM_API_KEY,
  TELEGRAM_CHAT_ID,
  GOOGLE_SHEET_ID,
  systemTimezone,
  systemName,
  currentDate,
} from "./SharedConfig.js";

const logger = createLogger("config");
logger("Parsing general config");
logToPublicLog("Parsing general config");

export {
  TELEGRAM_API_KEY,
  TELEGRAM_CHAT_ID,
  GOOGLE_SHEET_ID,
  systemTimezone,
  systemName,
  currentDate,
  classificationOptions,
  SHEET_NAMES,
  daysBackToScrape,
  scrapeStartDate,
  accounts,
};

logger("General Config parsed", {
  systemName,
  systemTimezone,
  currentDate,
  TELEGRAM_CHAT_ID,
});
