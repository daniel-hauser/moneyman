import debug from "debug";
import { existsSync, writeFileSync, writeSync } from "node:fs";
import { loggerContextStore } from "./asyncContext.js";

export const logger = debug("moneyman");

const originalLog = debug.log;
debug.log = function (...args: unknown[]) {
  const context = loggerContextStore.getStore();
  if (context) {
    if (typeof args[0] === "string") {
      args[0] = `${context.prefix} ${args[0]}`;
    } else {
      args.unshift(context.prefix);
    }
  }
  return originalLog.apply(this, args);
};

export function createLogger(name: string) {
  return logger.extend(name);
}

export const unsafeStdout = parseBoolean(process.env.MONEYMAN_UNSAFE_STDOUT);
const publicLogFd = Number.parseInt(
  process.env.MONEYMAN_PUBLIC_LOG_FD ?? "",
  10,
);

export function enableDebugLogging(debugFilter: string | undefined) {
  if (debugFilter && !process.env.DEBUG) {
    debug.enable(debugFilter);
  }
}

/**
 * Public logging is reserved for fixed operational messages that contain no
 * user data. Production GitHub Actions runs disable the Docker log driver.
 */
export function logToPublicLog(
  message: string,
  localLogger = createLogger("logToPublicLog"),
) {
  if (!unsafeStdout) {
    if (!Number.isNaN(publicLogFd)) {
      try {
        writeSync(publicLogFd, `${message}\n`);
        return;
      } catch (error) {
        localLogger(error);
      }
    }

    try {
      if (existsSync("/dev/tty")) {
        writeFileSync("/dev/tty", `${message}\n`);
        return;
      }
    } catch (error) {
      localLogger(error);
    }
  }

  console.log(message);
}

function parseBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === "true" || value === "1";
}
