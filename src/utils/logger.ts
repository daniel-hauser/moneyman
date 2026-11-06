import debug from "debug";
import { writeFileSync, existsSync, writeSync } from "fs";
import { BooleanEnvVarSchema, IntEnvVarSchema } from "../config.schema.js";
import { formatWithOptions, type InspectOptions } from "node:util";
import { inSpan, telemetryLogger } from "./telemetry.js";
import {
  context as otelContext,
  type Context,
  type Span,
  type SpanOptions,
} from "@opentelemetry/api";

export const logger = debug("moneyman");

// Keep source messages and namespace filters, not debug's terminal decoration.
debug.formatArgs = () => {};
debug.log = function (...args: unknown[]) {
  telemetryLogger.emit({
    context: otelContext.active(),
    body: formatWithOptions(
      (debug.inspectOpts ?? {}) as InspectOptions,
      ...args,
    ),
    attributes: {
      "log.namespace":
        (this as unknown as debug.Debugger)?.namespace ?? "debug",
    },
  });
};

type OperationOptions = SpanOptions & {
  name: string;
  parent?: Context;
};

export interface Logger extends debug.Debugger {
  extend(namespace: string, delimiter?: string): Logger;
  span<T>(
    options: OperationOptions,
    operation: (span: Span) => Promise<T>,
  ): Promise<T>;
}

function withSpans(debugger_: debug.Debugger): Logger {
  const extend = debugger_.extend.bind(debugger_);
  return Object.assign(debugger_, {
    extend: (namespace: string, delimiter?: string): Logger =>
      withSpans(extend(namespace, delimiter)),
    span: <T>(
      { name, parent = otelContext.active(), ...options }: OperationOptions,
      operation: (span: Span) => Promise<T>,
    ) =>
      inSpan(
        `${debugger_.namespace.replace(/^moneyman:?/, "").replaceAll(":", ".")}.${name}`,
        operation,
        options.attributes,
        parent,
        options,
      ),
  });
}

export function createLogger(name: string): Logger {
  return withSpans(logger.extend(name));
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
