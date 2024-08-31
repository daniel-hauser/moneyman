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

export const botTimeoutMinutes = 15; // Timeout duration in minutes

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
