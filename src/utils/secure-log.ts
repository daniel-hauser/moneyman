import { existsSync, unlinkSync, readFileSync } from "fs";
import { config } from "../config.js";
import { sendTextFile } from "../bot/notifier.js";
import { logToPublicLog, unsafeStdout, createLogger } from "./logger.js";
import { storages } from "../bot/storage/index.js";
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
  const logStorages = storages.filter((s) => typeof s.sendLogs === "function");
  const hasAnyLogDest =
    (telegram?.chatId && telegram?.sendLogFileToTelegram) ||
    logStorages.length > 0;

  if (!hasAnyLogDest) {
    logToPublicLog(
      "⚠️  WARNING: Output is redirected to a log file but no log destinations are configured. Errors and logs will not be visible",
      logger,
    );
  }

  try {
    if (telegram?.sendLogFileToTelegram) {
      logToPublicLog(`Sending log file`, logger);
      await sendTextFile(logFilePath);
    }

    // Send logs to all storages that support it
    if (logStorages.length > 0) {
      const logContent = readFileSync(logFilePath, "utf-8");

      for (const storage of logStorages) {
        const name = storage.constructor.name;
        logToPublicLog(`Sending logs to ${name}`, logger);
        try {
          await storage.sendLogs!(logContent);
        } catch (error) {
          logger(`Failed to send logs to ${name}:`, error);
        }
      }
    }

    logToPublicLog(`Deleting log file`, logger);
    unlinkSync(logFilePath);
  } catch (error) {
    logger(`sendAndDeleteLogFile Failed:`, error);
    logToPublicLog(`sendAndDeleteLogFile Failed`);
  }
}
