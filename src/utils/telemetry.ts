import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  type SpanOptions,
  type Attributes,
  createContextKey,
  type Context,
  type SpanContext,
} from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
  type LogRecordExporter,
} from "@opentelemetry/sdk-logs";
import {
  ExportResultCode,
  W3CTraceContextPropagator,
  type ExportResult,
} from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  JsonLogsSerializer,
  JsonTraceSerializer,
} from "@opentelemetry/otlp-transformer";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  openSync,
  writeSync,
} from "node:fs";
import { resolve } from "node:path";
import { isMainThread, threadId } from "node:worker_threads";

export const privateTelemetryPath = resolve(
  process.env.MONEYMAN_TELEMETRY_FILE_PATH ??
    `${process.env.MONEYMAN_LOG_FILE_PATH ?? "moneyman.log"}.otel.jsonl`,
);
const destinationKey = createContextKey("moneyman.telemetry.destination");
export const privateDeliveryTelemetryPath =
  privateTelemetryPath.replace(/(?:\.otel)?\.jsonl$/, "") +
  ".delivery.otel.jsonl";
export const deliveryTelemetryLimit = 1024 * 1024;

export function withDeliveryTelemetry<T>(operation: () => T): T {
  return context.with(
    context.active().setValue(destinationKey, privateDeliveryTelemetryPath),
    operation,
  );
}

// Each line is a standard OTLP/JSON export request, not terminal output.
export const privateTelemetrySink = {
  write(payload: Uint8Array | undefined) {
    if (!payload) return;
    const destination =
      (context.active().getValue(destinationKey) as string | undefined) ??
      privateTelemetryPath;
    const record = Buffer.concat([payload, Buffer.from("\n")]);
    const delivery = destination === privateDeliveryTelemetryPath;
    if (delivery && record.length > deliveryTelemetryLimit) {
      throw new Error(
        "Private delivery telemetry exceeded its retention budget",
      );
    }
    const fd = openSync(
      destination,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fchmodSync(fd, 0o600);
      if (
        delivery &&
        fstatSync(fd).size + record.length > deliveryTelemetryLimit
      ) {
        ftruncateSync(fd, 0);
      }
      writeSync(fd, record);
    } finally {
      closeSync(fd);
    }
  },
};

export const TELEMETRY_EXPORT_FAILURE =
  "Private telemetry could not be saved. Diagnostic records may be missing.";
let exportFailures = 0;

function exportPrivate(
  payload: () => Uint8Array | undefined,
  done: (result: ExportResult) => void,
) {
  try {
    privateTelemetrySink.write(payload());
    done({ code: ExportResultCode.SUCCESS });
  } catch (error) {
    exportFailures = Math.min(exportFailures + 1, Number.MAX_SAFE_INTEGER);
    done({
      code: ExportResultCode.FAILED,
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }
}

export const privateSpanExporter: SpanExporter = {
  export(spans, done) {
    exportPrivate(() => JsonTraceSerializer.serializeRequest(spans), done);
  },
  async shutdown() {},
};

export const privateLogExporter: LogRecordExporter = {
  export(records, done) {
    exportPrivate(() => JsonLogsSerializer.serializeRequest(records), done);
  },
  async shutdown() {},
  async forceFlush() {},
};

const resource = resourceFromAttributes({
  "service.name": "moneyman",
  "process.pid": process.pid,
  "thread.id": threadId,
  "thread.name": isMainThread ? "main" : "worker",
});
// Bounded per-operation breadcrumbs; OTLP also exports droppedEventsCount.
export const spanEventLimit = 1024;
const spanProcessor = new SimpleSpanProcessor(privateSpanExporter);
export const tracerProvider = new NodeTracerProvider({
  resource,
  spanLimits: { eventCountLimit: spanEventLimit },
  spanProcessors: [spanProcessor],
});
tracerProvider.register({ propagator: new W3CTraceContextPropagator() });
export const loggerProvider = new LoggerProvider({
  resource,
  processors: [new SimpleLogRecordProcessor(privateLogExporter)],
});
logs.setGlobalLoggerProvider(loggerProvider);
export const telemetryLogger = loggerProvider.getLogger("moneyman.debug");
export const tracer = tracerProvider.getTracer("moneyman");

const ancestryKey = createContextKey("moneyman.operation.ancestry");

export function isOperationDescendant(active: Context, owner: Context) {
  const expected = trace.getSpanContext(owner);
  if (!expected) return false;
  const ancestors =
    (active.getValue(ancestryKey) as readonly SpanContext[] | undefined) ?? [];
  return [trace.getSpanContext(active), ...ancestors].some(
    (candidate) =>
      candidate?.traceId === expected.traceId &&
      candidate.spanId === expected.spanId,
  );
}

export function spanEvent(
  name: string,
  attributes: Attributes = {},
  span = trace.getActiveSpan(),
) {
  span?.addEvent(name, attributes);
}

export function traceCarrier(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

export function parentContext(carrier: Record<string, string>) {
  return propagation.extract(ROOT_CONTEXT, carrier);
}

export async function inSpan<T>(
  name: string,
  operation: (span: import("@opentelemetry/api").Span) => Promise<T>,
  attributes: Attributes = {},
  parent = context.active(),
  options: SpanOptions = {},
): Promise<T> {
  const destination = context.active().getValue(destinationKey);
  if (destination) parent = parent.setValue(destinationKey, destination);
  return tracer.startActiveSpan(
    name,
    { ...options, attributes },
    parent,
    async (span) => {
      const ancestors =
        (parent.getValue(ancestryKey) as readonly SpanContext[] | undefined) ??
        [];
      const parentSpan = trace.getSpanContext(parent);
      return context.with(
        context
          .active()
          .setValue(
            ancestryKey,
            parentSpan ? [...ancestors, parentSpan] : ancestors,
          ),
        async () => {
          try {
            return await operation(span);
          } catch (error) {
            span.recordException(
              error instanceof Error ? error : String(error),
            );
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
          } finally {
            span.end();
          }
        },
      );
    },
  );
}

export async function flushTelemetry() {
  await Promise.all([tracerProvider.forceFlush(), loggerProvider.forceFlush()]);
  checkExportFailures();
}

export async function shutdownTelemetry() {
  await Promise.all([tracerProvider.shutdown(), loggerProvider.shutdown()]);
  checkExportFailures();
}

function checkExportFailures() {
  if (!exportFailures) return;
  exportFailures = 0;
  throw new Error(TELEMETRY_EXPORT_FAILURE);
}
