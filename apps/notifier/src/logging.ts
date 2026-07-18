import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createLogger, unsafeStdout } from "@moneyman/common";
import type { LogSource } from "@moneyman/protocol";
import { config } from "./config.js";
import { sendTextFile } from "./notifier.js";

const logger = createLogger("private-logs");
interface ReceivedLog {
  captured: boolean;
  content: string;
}

const receivedLogs = new Map<LogSource, ReceivedLog>();
const combinedLogPath =
  process.env.MONEYMAN_COMBINED_LOG_PATH ??
  "/run/moneyman/moneyman-combined.log";

export function receiveLog(
  source: LogSource,
  content: string,
  captured: boolean,
): boolean {
  if (receivedLogs.has(source)) {
    throw new Error(`Log source ${source} was already uploaded`);
  }
  receivedLogs.set(source, { captured, content });
  // Exporter uploads before responding to a successful scrape. Scraper is
  // therefore the terminal source and also finalizes early-failure logs.
  return source === "scraper";
}

export async function finalizeLogs() {
  const capturedLogs = config.expectedLogSources
    .map((source) => [source, receivedLogs.get(source)] as const)
    .filter((entry): entry is [LogSource, ReceivedLog] =>
      Boolean(entry[1]?.captured),
    );
  const sections = capturedLogs.map(
    ([source, log]) => `===== ${source.toUpperCase()} =====\n${log.content}`,
  );
  const notifierLogPath = process.env.MONEYMAN_PRIVATE_LOG_PATH;
  if (!unsafeStdout && notifierLogPath && existsSync(notifierLogPath)) {
    sections.push(
      `===== NOTIFIER =====\n${readFileSync(notifierLogPath, "utf8")}`,
    );
  }
  const combined = sections.join("\n\n");

  try {
    if (sections.length > 0 && config.telegram?.sendLogFileToTelegram) {
      mkdirSync(dirname(combinedLogPath), {
        recursive: true,
        mode: 0o700,
      });
      writeFileSync(combinedLogPath, combined, {
        encoding: "utf8",
        mode: 0o600,
      });
      await sendTextFile(combined, "moneyman.log", "Moneyman private logs");
    }
  } finally {
    rmSync(combinedLogPath, { force: true });
    receivedLogs.clear();
    logger("Combined private log delivered and removed");
  }
}
