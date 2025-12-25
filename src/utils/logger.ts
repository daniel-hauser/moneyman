import debug from "debug";
import { writeFileSync, existsSync, writeSync } from "fs";
import { BooleanEnvVarSchema, IntEnvVarSchema } from "../config.schema.js";
import { scraperContextStore } from "./asyncContext.js";

export const logger = debug("moneyman");

// Hook into debug.log to inject scraper context
const originalLog = debug.log;
debug.log = function (...args: unknown[]) {
  const context = scraperContextStore.getStore();
  if (context) {
    const prefix = `[#${context.index} ${context.companyId}]`;
    if (typeof args[0] === "string") {
      args[0] = `${prefix} ${args[0]}`;
    } else {
      args.unshift(prefix);
    }
  }
  return originalLog.apply(this, args);
};

export function createLogger(name: string) {
  return logger.extend(name);
}

export const unsafeStdout = BooleanEnvVarSchema.parse(
  process.env.MONEYMAN_UNSAFE_STDOUT,
);

const publicLogFd = IntEnvVarSchema.parse(process.env.MONEYMAN_PUBLIC_LOG_FD);

/**
 * Logs a message intended for public visibility.
 * When `MONEYMAN_UNSAFE_STDOUT` is `false`, prefers the preserved stdout FD (`MONEYMAN_PUBLIC_LOG_FD`),
 * then `/dev/tty` if present, otherwise falls back to `console.log`.
 * @unsafe
 */
export function logToPublicLog(
  message: string,
  logger = createLogger("logToPublicLog"),
) {
  if (!unsafeStdout) {
    if (!isNaN(publicLogFd)) {
      try {
        writeSync(publicLogFd as number, message + "\n");
        return;
      } catch (error) {
        logger(error);
      }
    }

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
