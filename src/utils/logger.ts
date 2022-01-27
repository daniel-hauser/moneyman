import debug from "debug";

export const logger = debug("moneyman");

export function createLogger(name: string) {
  return logger.extend(name);
}
