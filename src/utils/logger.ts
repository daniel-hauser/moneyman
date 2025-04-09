import debug from "debug";

export const logger = debug("moneyman");

export function createLogger(name: string) {
  return logger.extend(name);
}

/**
 * Logs a message to stdout. Will be publicly visible when running in GitHub actions
 * @unsafe
 */
export function logToPublicLog(message: string) {
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
