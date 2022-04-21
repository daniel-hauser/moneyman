import debug from "debug";

export const logger = debug("moneyman");

export function createLogger(name: string) {
  return logger.extend(name);
}

export function logToPublicLog(message: string) {
  console.log(message);
}
