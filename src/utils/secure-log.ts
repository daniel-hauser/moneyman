import { existsSync, unlinkSync } from "fs";
import { config } from "../config.js";
import { sendTextFile } from "../bot/notifier.js";
import { logToPublicLog, unsafeStdout, createLogger } from "./logger.js";

const logger = createLogger("secure-log");

export async function sendAndDeleteLogFile() {
  if (unsafeStdout) return;

  const logFilePath = process.env.MONEYMAN_LOG_FILE_PATH;
  if (!logFilePath) return;

  const telegram = config.options.notifications?.telegram;
  if (!telegram || !telegram.chatId || !telegram.sendLogFileToTelegram) {
    logToPublicLog(
      "⚠️  WARNING: Output is redirected to a log file but Telegram is not configured. Errors and logs will not be visible",
      logger,
    );
  }

  try {
    if (existsSync(logFilePath)) {
      if (telegram?.sendLogFileToTelegram) {
        logToPublicLog(`Sending log file`, logger);
        await sendTextFile(logFilePath);
      }
      logToPublicLog(`Deleting log file`, logger);
      unlinkSync(logFilePath);
    }
  } catch (error) {
    logger(`sendAndDeleteLogFile Failed:`, error);
    logToPublicLog(`sendAndDeleteLogFile Failed`);
  }
}
