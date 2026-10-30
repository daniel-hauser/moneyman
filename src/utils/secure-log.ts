import { existsSync, unlinkSync, truncateSync, readFileSync } from "fs";
import { config } from "../config.js";
import { logToPublicLog, unsafeStdout, createLogger } from "./logger.js";
import type { TransactionStorage } from "../types.js";
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

export function readReportLogs(): string | undefined {
  const telegram = config.options.notifications?.telegram;
  const logFilePath = process.env.MONEYMAN_LOG_FILE_PATH;
  if (
    unsafeStdout ||
    !telegram?.chatId ||
    !telegram.sendLogFileToTelegram ||
    !logFilePath
  ) {
    return;
  }

  try {
    return readFileSync(logFilePath, "utf-8");
  } catch (error) {
    logger("Failed to read logs for report:", error);
  }
}

export async function sendLogFile(
  deleteFile: boolean,
  storages: readonly TransactionStorage[] = [],
) {
  if (unsafeStdout) return;

  const logFilePath = process.env.MONEYMAN_LOG_FILE_PATH;
  if (!logFilePath || !existsSync(logFilePath)) return;

  const telegram = config.options.notifications?.telegram;
  const logStorages = storages.filter(
    (s): s is TransactionStorage & { sendLogs(logs: string): Promise<void> } =>
      typeof s.sendLogs === "function",
  );
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
    // Send logs to all storages that support it
    if (logStorages.length > 0) {
      const logContent = readFileSync(logFilePath, "utf-8");

      const results = await Promise.allSettled(
        logStorages.map(async (storage) => {
          const name = storage.constructor.name;
          logToPublicLog(`Sending logs to ${name}`, logger);
          await storage.sendLogs(logContent);
        }),
      );

      for (const [i, result] of results.entries()) {
        if (result.status === "rejected") {
          const name = logStorages[i].constructor.name;
          logger(`Failed to send logs to ${name}:`, result.reason);
          logToPublicLog(`Failed to send logs to ${name}`, logger);
        }
      }
    }
  } catch (error) {
    logger(`sendLogFile Failed:`, error);
    logToPublicLog(`sendLogFile Failed`);
  } finally {
    try {
      if (deleteFile) {
        logToPublicLog(`Deleting log file`, logger);
        unlinkSync(logFilePath);
      } else {
        logToPublicLog(`Clearing log file`, logger);
        truncateSync(logFilePath, 0);
      }
    } catch (error) {
      logger("Failed to clear log file:", error);
      logToPublicLog("Failed to clear log file", logger);
    }
  }
}
