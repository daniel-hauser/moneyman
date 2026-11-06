import { existsSync, unlinkSync, truncateSync, readFileSync } from "fs";
import { config } from "../config.js";
import { sendTextFile } from "../bot/notifier.js";
import { logToPublicLog, unsafeStdout, createLogger } from "./logger.js";
import type { TransactionStorage } from "../types.js";
import debug from "debug";
import { privateTelemetryPath } from "./telemetry.js";
import type { ReportLogInput } from "../bot/report/diagnostics.js";

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

export function readReportLogs(structured = false): ReportLogInput | undefined {
  const telegram = config.options.notifications?.telegram;
  const logFilePath = process.env.MONEYMAN_LOG_FILE_PATH;
  if (
    unsafeStdout ||
    !telegram?.chatId ||
    !telegram.sendLogFileToTelegram ||
    !telegram.sendReportFileToTelegram
  ) {
    return;
  }

  try {
    if (structured) {
      const read = (path: string | undefined) =>
        path && existsSync(path) ? readFileSync(path, "utf-8") : "";
      const console = read(logFilePath);
      const telemetry = read(privateTelemetryPath);
      return console || telemetry ? { console, telemetry } : undefined;
    }
    return readPrivateLogs(logFilePath);
  } catch (error) {
    logger("Failed to read logs for report:", error);
  }
}

function privateLogPaths(logFilePath?: string) {
  return [logFilePath, privateTelemetryPath].filter((path): path is string =>
    Boolean(path && existsSync(path)),
  );
}

function readPrivateLogs(logFilePath?: string) {
  const paths = privateLogPaths(logFilePath);
  if (!paths.length) return;
  return paths.map((path) => readFileSync(path, "utf-8")).join("\n");
}

export async function sendLogFile(
  deleteFile: boolean,
  storages: readonly TransactionStorage[] = [],
  logsSent = false,
) {
  if (unsafeStdout) return;

  const logFilePath = process.env.MONEYMAN_LOG_FILE_PATH;
  const logPaths = privateLogPaths(logFilePath);
  if (!logPaths.length) return;

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
    if (telegram?.sendLogFileToTelegram && !logsSent) {
      logToPublicLog("Sending log file", logger);
      for (const path of logPaths) {
        await sendTextFile(path).catch((error) => {
          logger("Failed to send logs to Telegram:", error);
          logToPublicLog("Failed to send logs to Telegram", logger);
        });
      }
    }

    // Send logs to all storages that support it
    if (logStorages.length > 0) {
      const logContent = readPrivateLogs(logFilePath) ?? "";

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
        for (const path of logPaths) unlinkSync(path);
      } else {
        logToPublicLog(`Clearing log file`, logger);
        for (const path of logPaths) truncateSync(path, 0);
      }
    } catch (error) {
      logger("Failed to clear log file:", error);
      logToPublicLog("Failed to clear log file", logger);
    }
  }
}
