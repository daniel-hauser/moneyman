import debug from "debug";
import { writeFileSync, existsSync } from "fs";
import { BooleanEnvVarSchema } from "../config.schema.js";

export const logger = debug("moneyman");

export function createLogger(name: string) {
  return logger.extend(name);
}

export const unsafeStdout = BooleanEnvVarSchema.parse(
  process.env.MONEYMAN_UNSAFE_STDOUT,
);

/**
 * Logs a message intended for public visibility.
 * When `MONEYMAN_UNSAFE_STDOUT` is `false` and `/dev/tty` exists, writes to `/dev/tty` to bypass stdout redirection;
 * otherwise falls back to `console.log`.
 * @unsafe
 */
export function logToPublicLog(
  message: string,
  logger = createLogger("logToPublicLog"),
) {
  if (!unsafeStdout) {
    try {
      if (existsSync("/dev/tty")) {
        writeFileSync("/dev/tty", message + "\n");
        return;
      }
    } catch (error) {
      logger(error);
    }
  }
  console.log(message);
}

export const metadataLogEntries: string[] = [];
const metadataLogger = createLogger("metadataLogger");

/**
 * Logs a message to the metadata file sent to the chat
 * @param message The message to log.
 */
export function logToMetadataFile(message: string) {
  const date = new Date().toISOString();
  metadataLogEntries.push(`[${date}] ${message}`);
  metadataLogger(message);
  return message;
}
