import { existsSync, unlinkSync, truncateSync, readFileSync } from "fs";
import { config } from "../config.js";
import { sendTextFile } from "../bot/notifier.js";
import { logToPublicLog, unsafeStdout, createLogger } from "./logger.js";
import { longRunning } from "./env.js";
import { storages } from "../bot/storage/index.js";
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

/**
 * The docker entrypoint opens the log file in append mode only when it knows
 * the process is long running. Starting the long running server without the
 * variable leaves the file opened for truncation, while the app empties it
 * between runs and the writes would land after a hole of NUL bytes - or, with
 * `longRunning` false, the app deletes the file after the first run and the
 * later runs lose their logs. There is no way to fix the already opened
 * descriptor from here, so refuse to start.
 */
export function assertLongRunningLogMode() {
  if (longRunning || unsafeStdout || !process.env.MONEYMAN_LOG_FILE_PATH)
    return;

  throw new Error(
    "MONEYMAN_LONG_RUNNING is not set while the long running server starts: " +
      "the entrypoint would open the log file without append mode, so the logs " +
      "of every run after the first would be lost. Set " +
      "MONEYMAN_LONG_RUNNING=true on the container instead of overriding its " +
      "command.",
  );
}

/**
 * Send the log file to every destination and then clear it. The run id is
 * passed in because this runs after the run context has ended.
 */
export async function sendAndDeleteLogFile(runId?: string) {
  if (unsafeStdout) return;

  const logFilePath = process.env.MONEYMAN_LOG_FILE_PATH;
  if (!logFilePath || !existsSync(logFilePath)) return;

  const telegram = config.options.notifications?.telegram;
  const logStorages = (storages as TransactionStorage[]).filter(
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
    if (telegram?.sendLogFileToTelegram) {
      logToPublicLog(`Sending log file`, logger);
      await sendTextFile(logFilePath);
    }

    // Send logs to all storages that support it
    if (logStorages.length > 0) {
      const logContent = readFileSync(logFilePath, "utf-8");

      const results = await Promise.allSettled(
        logStorages.map(async (storage) => {
          const name = storage.constructor.name;
          logToPublicLog(`Sending logs to ${name}`, logger);
          await storage.sendLogs(logContent, runId);
        }),
      );

      for (const [i, result] of results.entries()) {
        if (result.status === "rejected") {
          const name = logStorages[i].constructor.name;
          logger(`Failed to send logs to ${name}:`, result.reason);
        }
      }
    }

    if (longRunning) {
      /**
       * In long running mode the log file is held open by the entrypoint for
       * the lifetime of the process, so it can be emptied but not deleted.
       * The entrypoint opens it in append mode, so the next run starts writing
       * at the beginning of the file again.
       */
      logToPublicLog(`Clearing log file`, logger);
      truncateSync(logFilePath, 0);
    } else {
      logToPublicLog(`Deleting log file`, logger);
      unlinkSync(logFilePath);
    }
  } catch (error) {
    logger(`sendAndDeleteLogFile Failed:`, error);
    logToPublicLog(`sendAndDeleteLogFile Failed`);
  }
}
