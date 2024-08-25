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

logger("Parsing classify config");
logToPublicLog("Parsing classify config");

export {
  TELEGRAM_API_KEY,
  TELEGRAM_CHAT_ID,
  GOOGLE_SHEET_ID,
  systemName,
  systemTimezone,
  currentDate,
};

logger("Classify Config parsed", {
  systemName,
  systemTimezone,
  currentDate,
  TELEGRAM_CHAT_ID,
});
