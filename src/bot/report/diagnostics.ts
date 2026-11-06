import { compilePattern, matchPattern } from "./wildcard.js";

/** Separate private sources; the legacy string report input remains supported. */
export interface ReportDiagnosticSources {
  console: string;
  telemetry: string;
}

export type ReportLogInput = string | ReportDiagnosticSources;
export type DiagnosticAttributes = Record<string, string>;

export interface DiagnosticSpan {
  key: string;
  traceId: string;
  spanId: string;
  parentKey?: string;
  name: string;
  start: string;
  end?: string;
  attributes: DiagnosticAttributes;
  resource: DiagnosticAttributes;
  status: string;
  droppedEvents: number;
  events: DiagnosticEvent[];
}

export interface DiagnosticEvent {
  id: string;
  type: "log" | "milestone" | "exception";
  time: string;
  name: string;
  body: string;
  ownerKey?: string;
  traceId: string;
  attributes: DiagnosticAttributes;
  resource: DiagnosticAttributes;
}

export interface Diagnostics {
  spans: DiagnosticSpan[];
  events: DiagnosticEvent[];
  warnings: string[];
  origin: string;
  droppedEvents: number;
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const nanos = (value: unknown) =>
  typeof value === "string" && /^\d+$/.test(value) ? value : "0";
const key = (traceId: string, spanId: string) => `${traceId}/${spanId}`;

function anyValue(value: unknown, invalid: () => void): string {
  const entry = object(value);
  if (!entry) {
    invalid();
    return "";
  }
  for (const field of [
    "stringValue",
    "intValue",
    "doubleValue",
    "boolValue",
    "bytesValue",
  ]) {
    if (entry[field] !== undefined) {
      if (!["string", "number", "boolean"].includes(typeof entry[field]))
        invalid();
      return String(entry[field]);
    }
  }
  if (entry.arrayValue)
    return JSON.stringify(
      array(object(entry.arrayValue)?.values).map((value) =>
        anyValue(value, invalid),
      ),
    );
  if (entry.kvlistValue)
    return JSON.stringify(
      attributes(object(entry.kvlistValue)?.values, invalid),
    );
  invalid();
  return "";
}

function attributes(value: unknown, invalid: () => void): DiagnosticAttributes {
  if (value !== undefined && !Array.isArray(value)) invalid();
  return Object.fromEntries(
    array(value).flatMap((item) => {
      const entry = object(item);
      if (!entry || typeof entry.key !== "string") {
        invalid();
        return [];
      }
      return [[entry.key, anyValue(entry.value, invalid)]];
    }),
  );
}

/** Parse only at the server/report boundary. No SDK or Node code enters the UI. */
export function parseDiagnostics(source: string): Diagnostics {
  const spans = new Map<string, DiagnosticSpan>();
  const logs: DiagnosticEvent[] = [];
  const warnings: string[] = [];
  let sequence = 0;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let request: Record<string, unknown> | undefined;
    try {
      request = object(JSON.parse(line));
    } catch {
      warnings.push(
        `Line ${index + 1}: invalid JSON; original retained in download.`,
      );
      continue;
    }
    if (
      !request ||
      (!Array.isArray(request.resourceSpans) &&
        !Array.isArray(request.resourceLogs))
    ) {
      warnings.push(
        `Line ${index + 1}: unsupported OTLP request; original retained in download.`,
      );
      continue;
    }
    const invalid = () =>
      warnings.push(
        `Line ${index + 1}: malformed OTLP entry; original retained in download.`,
      );
    const time = (value: unknown) => {
      if (
        value !== undefined &&
        (typeof value !== "string" || !/^\d+$/.test(value))
      )
        invalid();
      const result = nanos(value);
      return BigInt(result) === 0n ? "0" : result;
    };
    for (const resourceValue of array(request.resourceSpans)) {
      const resource = object(resourceValue);
      if (!resource || !Array.isArray(resource.scopeSpans)) {
        invalid();
        continue;
      }
      const metadata = attributes(
        object(resource.resource)?.attributes,
        invalid,
      );
      for (const scopeValue of resource.scopeSpans) {
        const scope = object(scopeValue);
        if (!scope || !Array.isArray(scope.spans)) {
          invalid();
          continue;
        }
        for (const value of scope.spans) {
          const span = object(value);
          const traceId = text(span?.traceId);
          const spanId = text(span?.spanId);
          if (!span || !traceId || !spanId || !text(span.name)) {
            invalid();
            continue;
          }
          const ownerKey = key(traceId, spanId);
          const end = time(span.endTimeUnixNano);
          const status = object(span.status);
          const normalized: DiagnosticSpan = {
            key: ownerKey,
            traceId,
            spanId,
            parentKey: text(span.parentSpanId)
              ? key(traceId, text(span.parentSpanId))
              : undefined,
            name: text(span.name),
            start: time(span.startTimeUnixNano),
            end: end === "0" ? undefined : end,
            attributes: attributes(span.attributes, invalid),
            resource: metadata,
            status:
              status?.code === 2 || status?.code === "STATUS_CODE_ERROR"
                ? `error${text(status.message) ? `: ${text(status.message)}` : ""}`
                : end === "0"
                  ? "running"
                  : status?.code === 1 || status?.code === "STATUS_CODE_OK"
                    ? "ok"
                    : "completed",
            droppedEvents:
              typeof span.droppedEventsCount === "number"
                ? Math.max(0, span.droppedEventsCount)
                : 0,
            events: [],
          };
          if (span.events !== undefined && !Array.isArray(span.events))
            invalid();
          for (const eventValue of array(span.events)) {
            const event = object(eventValue);
            if (!event || !text(event.name)) {
              invalid();
              continue;
            }
            const attrs = attributes(event.attributes, invalid);
            normalized.events.push({
              id: `event-${sequence++}`,
              type: event.name === "exception" ? "exception" : "milestone",
              time: time(event.timeUnixNano),
              name: text(event.name),
              body:
                event.name === "exception"
                  ? [attrs["exception.message"], attrs["exception.stacktrace"]]
                      .filter(Boolean)
                      .join("\n")
                  : [text(event.name), attrs.step, attrs.reason]
                      .filter(Boolean)
                      .join(" · "),
              ownerKey,
              traceId,
              attributes: attrs,
              resource: metadata,
            });
          }
          const previous = spans.get(ownerKey);
          // Legacy active snapshots must not replace a completed export.
          if (
            !previous ||
            BigInt(normalized.end ?? "0") > BigInt(previous.end ?? "0") ||
            (normalized.end === previous.end &&
              normalized.events.length >= previous.events.length)
          )
            spans.set(ownerKey, normalized);
        }
      }
    }
    for (const resourceValue of array(request.resourceLogs)) {
      const resource = object(resourceValue);
      if (!resource || !Array.isArray(resource.scopeLogs)) {
        invalid();
        continue;
      }
      const metadata = attributes(
        object(resource.resource)?.attributes,
        invalid,
      );
      for (const scopeValue of resource.scopeLogs) {
        const scope = object(scopeValue);
        if (!scope || !Array.isArray(scope.logRecords)) {
          invalid();
          continue;
        }
        for (const value of scope.logRecords) {
          const log = object(value);
          if (!log || !object(log.body)) {
            invalid();
            continue;
          }
          const traceId = text(log.traceId);
          const spanId = text(log.spanId);
          const attrs = attributes(log.attributes, invalid);
          if (text(log.severityText))
            attrs["log.severity"] = text(log.severityText);
          if (typeof log.severityNumber === "number" && log.severityNumber > 0)
            attrs["log.severityNumber"] = String(log.severityNumber);
          logs.push({
            id: `event-${sequence++}`,
            type: "log",
            time: time(log.timeUnixNano ?? log.observedTimeUnixNano),
            name: "log",
            body: anyValue(log.body, invalid),
            ownerKey: traceId && spanId ? key(traceId, spanId) : undefined,
            traceId,
            attributes: attrs,
            resource: metadata,
          });
        }
      }
    }
  }
  const operations = [...spans.values()];
  const events = [
    ...logs,
    ...operations.flatMap((span) => {
      const boundary = (end: boolean): DiagnosticEvent => ({
        id: `${span.key}/${end ? "end" : "start"}`,
        type: "milestone",
        time: end ? span.end! : span.start,
        name: `${span.name} ${end ? span.status : "started"}`,
        body: `${span.name} ${end ? span.status : "started"}`,
        ownerKey: span.key,
        traceId: span.traceId,
        attributes: {},
        resource: span.resource,
      });
      return [
        boundary(false),
        ...span.events,
        ...(span.end ? [boundary(true)] : []),
      ];
    }),
  ].sort((a, b) => compareTime(a.time, b.time));
  const times = [
    ...events.map((event) => event.time),
    ...operations.map((span) => span.start),
  ]
    .filter((time) => time !== "0")
    .sort(compareTime);
  return {
    spans: operations,
    events,
    warnings,
    origin: times[0] ?? "0",
    droppedEvents: operations.reduce(
      (sum, span) => sum + span.droppedEvents,
      0,
    ),
  };
}

function compareTime(a: string, b: string) {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}

export function elapsedMs(time: string, origin: string) {
  return Number(BigInt(time) - BigInt(origin)) / 1_000_000;
}

export function timestamp(time: string) {
  if (time === "0") return "Time unknown";
  const ms = Number(BigInt(time) / 1_000_000n);
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15
    ? new Date(ms).toISOString()
    : "Time out of range";
}

export function spanAncestors(
  spanKey: string | undefined,
  spans: ReadonlyMap<string, DiagnosticSpan>,
) {
  const result: DiagnosticSpan[] = [];
  const seen = new Set<string>();
  let span = spanKey ? spans.get(spanKey) : undefined;
  while (span && !seen.has(span.key)) {
    seen.add(span.key);
    result.unshift(span);
    span = span.parentKey ? spans.get(span.parentKey) : undefined;
  }
  return result;
}

export function effectiveAttributes(
  event: DiagnosticEvent,
  spans: ReadonlyMap<string, DiagnosticSpan>,
): DiagnosticAttributes {
  const ancestors = spanAncestors(event.ownerKey, spans);
  return Object.fromEntries(
    [
      ...ancestors.map((span) => span.resource),
      event.resource,
      ...ancestors.map((span) => span.attributes),
      event.attributes,
    ].flatMap((attrs) => Object.entries(attrs)),
  );
}

export interface DiagnosticQuery {
  term?: string;
  traceId?: string;
  operation?: string;
  descendants?: boolean;
  type?: string;
  facets?: DiagnosticAttributes;
}

export function queryDiagnostics(data: Diagnostics, query: DiagnosticQuery) {
  const spans = new Map(data.spans.map((span) => [span.key, span]));
  const tokens = compilePattern(query.term ?? "");
  return data.events.filter((event) => {
    if (query.traceId && event.traceId !== query.traceId) return false;
    if (
      query.operation &&
      !(query.descendants !== false
        ? spanAncestors(event.ownerKey, spans).some(
            (span) => span.key === query.operation,
          )
        : event.ownerKey === query.operation)
    )
      return false;
    if (query.type === "failure") {
      const owner = event.ownerKey ? spans.get(event.ownerKey) : undefined;
      if (
        event.type !== "exception" &&
        !(owner?.status.startsWith("error") && event.id === `${owner.key}/end`)
      )
        return false;
    } else if (query.type && event.type !== query.type) return false;
    const attrs = effectiveAttributes(event, spans);
    if (
      Object.entries(query.facets ?? {}).some(
        ([name, value]) => value && attrs[name] !== value,
      )
    )
      return false;
    return (
      !query.term ||
      matchPattern(
        [event.name, event.body, ...Object.entries(attrs).flat()].join("\n"),
        tokens,
      ).matched
    );
  });
}

export function operationLabel(span: DiagnosticSpan) {
  const attrs = span.attributes;
  return [
    span.name,
    attrs["account.company"],
    attrs["account.index"] !== undefined
      ? `account ${attrs["account.index"]}`
      : "",
    attrs["storage.name"],
  ]
    .filter(Boolean)
    .join(" · ");
}
