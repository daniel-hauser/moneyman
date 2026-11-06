import {
  context,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import debug from "debug";
import { createLogger } from "./logger.js";
import {
  flushTelemetry,
  inSpan,
  parentContext,
  privateLogExporter,
  privateSpanExporter,
  privateTelemetrySink,
  spanEventLimit,
  TELEMETRY_EXPORT_FAILURE,
  spanEvent,
  traceCarrier,
} from "./telemetry.js";
import { WorkerConfigSchema } from "../scraper/protocol.js";

describe("real OpenTelemetry correlation", () => {
  let spans: ReadableSpan[];
  let records: ReadableLogRecord[];
  let filter: string;
  beforeEach(() => {
    spans = [];
    records = [];
    filter = debug.disable();
    debug.enable("moneyman:*,israeli-bank-scrapers:*");
    jest
      .spyOn(privateSpanExporter, "export")
      .mockImplementation((batch, done) => {
        spans.push(...batch);
        done({ code: ExportResultCode.SUCCESS });
      });
    jest
      .spyOn(privateLogExporter, "export")
      .mockImplementation((batch, done) => {
        records.push(...batch);
        done({ code: ExportResultCode.SUCCESS });
      });
  });
  afterEach(() => {
    debug.enable(filter);
    jest.restoreAllMocks();
  });

  it("keeps callable debugger extensions and filters without starting spans on logger creation", async () => {
    const logger = createLogger("storage");
    const compatible: debug.Debugger = logger;
    expect(compatible.namespace).toBe("moneyman:storage");
    const child = logger.extend("fixture");
    expect(child.namespace).toBe("moneyman:storage:fixture");
    expect(logger.extend("custom", "/").namespace).toBe(
      "moneyman:storage/custom",
    );
    expect(spans).toHaveLength(0);
    debug.enable("moneyman:storage:fixture");
    expect(
      await child.span(
        { name: "save", attributes: { "transaction.count": 2 } },
        async (span) => {
          expect(trace.getActiveSpan()).toBe(span);
          child("included");
          logger("excluded");
          await child.span({ name: "nested" }, async () => child("inherited"));
          return 42;
        },
      ),
    ).toBe(42);
    expect(spans.map((span) => span.name)).toEqual([
      "storage.fixture.nested",
      "storage.fixture.save",
    ]);
    expect(spans[0].parentSpanContext).toEqual(spans[1].spanContext());
    expect(spans[1].attributes).toEqual({ "transaction.count": 2 });
    expect(records.map((record) => record.body)).toEqual([
      "included",
      "inherited",
    ]);
  });

  it("exports root → serialized worker parent → concurrent account lineage and multiline downstream messages", async () => {
    const logger = createLogger("scraper");
    const ready = Promise.withResolvers<void>();
    await logger.span({ name: "run", parent: ROOT_CONTEXT }, async (root) => {
      const carrier = WorkerConfigSchema.shape.traceCarrier.parse(
        structuredClone(traceCarrier()),
      );
      expect(() =>
        WorkerConfigSchema.shape.traceCarrier.parse({
          ...carrier,
          secret: "not allowed",
        }),
      ).toThrow();
      expect(() =>
        WorkerConfigSchema.shape.traceCarrier.parse({ traceparent: "invalid" }),
      ).toThrow();
      await logger.span(
        { name: "worker", parent: parentContext(carrier) },
        async (worker) => {
          await Promise.all(
            [0, 1].map((i) =>
              logger.span(
                {
                  name: "account",
                  attributes: {
                    "account.index": i,
                    "account.company": "fixture",
                  },
                },
                async (span) => {
                  if (i === 0) await ready.promise;
                  else ready.resolve();
                  debug("israeli-bank-scrapers:fixture")(
                    "account %d\nnext line",
                    i,
                  );
                  expect(span.spanContext().traceId).toBe(
                    root.spanContext().traceId,
                  );
                  expect(trace.getActiveSpan()).toBe(span);
                },
              ),
            ),
          );
          expect(trace.getActiveSpan()).toBe(worker);
        },
      );
    });
    await flushTelemetry();
    const root = spans.find((span) => span.name === "scraper.run")!;
    const worker = spans.find((span) => span.name === "scraper.worker")!;
    expect(root.parentSpanContext).toBeUndefined();
    expect(worker.parentSpanContext).toMatchObject({
      traceId: root.spanContext().traceId,
      spanId: root.spanContext().spanId,
      isRemote: true,
    });
    for (const i of [0, 1]) {
      const account = spans.find(
        (span) => span.attributes["account.index"] === i,
      )!;
      expect(account.parentSpanContext).toEqual(worker.spanContext());
      const record = records.find(
        (record) => record.body === `account ${i}\nnext line`,
      )!;
      expect(record.spanContext?.spanId).toBe(account.spanContext().spanId);
      expect(record.attributes).toEqual({
        "log.namespace": "israeli-bank-scrapers:fixture",
      });
    }
    expect(trace.getActiveSpan()).toBeUndefined();
  });

  it("binds browser/security callbacks to their owning span under unrelated delivery context", async () => {
    const logger = createLogger("callback");
    await logger.span(
      { name: "owner", attributes: { "account.company": "fixture" } },
      async (owner) => {
        const callback = context.bind(context.active(), () => {
          expect(trace.getActiveSpan()?.spanContext()).toEqual(
            owner.spanContext(),
          );
          logger("owned callback");
        });
        await logger.span({ name: "unrelated" }, async () => callback());
        expect(records[0].spanContext?.spanId).toBe(owner.spanContext().spanId);
      },
    );
  });

  it("ends failed, returned-failure and cancelled operations with exception/status metadata", async () => {
    const logger = createLogger("failure");
    await expect(
      logger.span({ name: "throw" }, async () => {
        throw new TypeError("invented failure");
      }),
    ).rejects.toThrow("invented failure");
    await inSpan("returned-failure", async (span) => {
      span.setStatus({ code: SpanStatusCode.ERROR });
      return false;
    });
    await expect(
      logger.span({ name: "cancel" }, async () =>
        AbortSignal.abort(new Error("cancelled")).throwIfAborted(),
      ),
    ).rejects.toThrow("cancelled");
    expect(spans.map((span) => [span.status.code, span.ended])).toEqual(
      Array(3).fill([SpanStatusCode.ERROR, true]),
    );
    expect(spans[0].events).toContainEqual(
      expect.objectContaining({
        name: "exception",
        attributes: expect.objectContaining({
          "exception.type": "TypeError",
          "exception.message": "invented failure",
          "exception.stacktrace": expect.stringContaining("invented failure"),
        }),
      }),
    );
    expect(trace.getSpan(context.active())).toBeUndefined();
  });

  it("surfaces export failures without recursively logging or exposing private error details", async () => {
    jest.mocked(privateSpanExporter.export).mockRestore();
    jest.mocked(privateLogExporter.export).mockRestore();
    const failure = new Error(
      "ENOSPC: invented-private-path/invented-secret.otel.jsonl",
    );
    const sink = jest
      .spyOn(privateTelemetrySink, "write")
      .mockImplementation(() => {
        throw failure;
      });
    await createLogger("failure").span({ name: "export" }, async () => {
      createLogger("failure")("invented private diagnostic");
    });
    await expect(flushTelemetry()).rejects.toThrow(TELEMETRY_EXPORT_FAILURE);
    await expect(flushTelemetry()).resolves.toBeUndefined();
    expect(sink).toHaveBeenCalledTimes(2);
    const done = jest.fn();
    privateLogExporter.export([], done);
    expect(done).toHaveBeenCalledWith({
      code: ExportResultCode.FAILED,
      error: failure,
    });
    await expect(flushTelemetry()).rejects.toThrow(TELEMETRY_EXPORT_FAILURE);
  });

  it("serializes only completed standard OTLP spans with their milestones", async () => {
    jest.mocked(privateSpanExporter.export).mockRestore();
    jest.mocked(privateLogExporter.export).mockRestore();
    const payloads: string[] = [];
    jest.spyOn(privateTelemetrySink, "write").mockImplementation((payload) => {
      payloads.push(Buffer.from(payload!).toString());
    });
    const stderr = jest.spyOn(process.stderr, "write").mockReturnValue(true);
    const stdout = jest.spyOn(process.stdout, "write").mockReturnValue(true);
    const logger = createLogger("storage");
    await expect(
      logger.span(
        { name: "save", attributes: { "storage.name": "invented" } },
        async (span) => {
          span.addEvent("storage.initialize");
          spanEvent("storage.progress", { step: "write" });
          logger("first line\nsecond line");
          expect(
            payloads.some((payload) => JSON.parse(payload).resourceSpans),
          ).toBe(false);
          throw new Error("invented write failure");
        },
      ),
    ).rejects.toThrow("invented write failure");
    await flushTelemetry();
    const exports = payloads.map((payload) => JSON.parse(payload));
    const span = exports.filter((payload) => payload.resourceSpans).at(-1)
      .resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).toBe("storage.save");
    expect(span.endTimeUnixNano).not.toBe("0");
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.map((event: { name: string }) => event.name)).toEqual([
      "storage.initialize",
      "storage.progress",
      "exception",
    ]);
    const log = exports.find((payload) => payload.resourceLogs).resourceLogs[0];
    expect(log.scopeLogs[0].logRecords[0].body.stringValue).toBe(
      "first line\nsecond line",
    );
    expect(log.resource.attributes).toContainEqual({
      key: "thread.name",
      value: { stringValue: "main" },
    });
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });

  it.each(["israeli-bank-scrapers:*", "moneyman:storage"])(
    "exports lineage and breadcrumbs independently of DEBUG=%s",
    async (filter) => {
      jest.mocked(privateSpanExporter.export).mockRestore();
      const payloads: string[] = [];
      jest
        .spyOn(privateTelemetrySink, "write")
        .mockImplementation((payload) => {
          payloads.push(Buffer.from(payload!).toString());
        });
      debug.enable(filter);
      await inSpan(
        "account",
        async () => {
          spanEvent("account.progress");
          debug("israeli-bank-scrapers:fixture")("invented");
          createLogger("storage")("invented");
        },
        { "account.company": "fixture" },
      );
      await flushTelemetry();
      const span = JSON.parse(payloads[0]).resourceSpans[0].scopeSpans[0]
        .spans[0];
      expect(span.attributes).toContainEqual({
        key: "account.company",
        value: { stringValue: "fixture" },
      });
      expect(span.events[0].name).toBe("account.progress");
      expect(records).toHaveLength(1);
    },
  );

  it("retains normal progress budgets and exposes native overflow metadata", async () => {
    await inSpan("normal", async () => {
      spanEvent("initialize");
      for (let i = 0; i < 140; i++) spanEvent(`step-${i}`);
    });
    expect(spans[0].events).toHaveLength(141);
    expect(spans[0].events[0].name).toBe("initialize");
    await inSpan("overflow", async (span) => {
      for (let i = 0; i < spanEventLimit + 10; i++) spanEvent(`step-${i}`);
      span.recordException(new Error("invented failure"));
    });
    expect(spans[1].events).toHaveLength(spanEventLimit);
    expect(spans[1].droppedEventsCount).toBe(11);
    expect(spans[1].events.at(-1)?.name).toBe("exception");
  });
});
