import { existsSync, unlinkSync } from "fs";
import { config } from "../config.js";
import { sendTextFile } from "../bot/notifier.js";
import { logToPublicLog, unsafeStdout, createLogger } from "./logger.js";
import debug from "debug";

const logger = createLogger("secure-log");

/**
 * Enable debug logging if configured.
 * Only enables if:
 * - A debugFilter is configured in logging options
 * - Unsafe stdout is disabled (logs are being captured)
 * - User hasn't already enabled debug via DEBUG env var
 */
export function enableDebugLoggingIfNeeded() {
  if (
    config.options.logging.debugFilter &&
    !unsafeStdout &&
    !process.env.DEBUG
  ) {
    debug.enable(config.options.logging.debugFilter);
  }
}

export async function sendAndDeleteLogFile() {
  if (unsafeStdout) return;

  const logFilePath = process.env.MONEYMAN_LOG_FILE_PATH;
  if (!logFilePath || !existsSync(logFilePath)) return;

  const telegram = config.options.notifications?.telegram;
  if (!telegram || !telegram.chatId || !telegram.sendLogFileToTelegram) {
    logToPublicLog(
      "⚠️  WARNING: Output is redirected to a log file but Telegram is not configured. Errors and logs will not be visible",
      logger,
    );
  }

  try {
    if (telegram?.sendLogFileToTelegram) {
      logToPublicLog(`Sending log file`, logger);
      await sendTextFile(logFilePath);
    }
    logToPublicLog(`Deleting log file`, logger);
    unlinkSync(logFilePath);
  } catch (error) {
    logger(`sendAndDeleteLogFile Failed:`, error);
    logToPublicLog(`sendAndDeleteLogFile Failed`);
  }
}
