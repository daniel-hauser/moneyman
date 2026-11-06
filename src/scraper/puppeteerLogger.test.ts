import { context, trace } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import debug from "debug";
import { createPuppeteerLogger } from "./puppeteerLogger.js";
import { createLogger } from "../utils/logger.js";
import {
  flushTelemetry,
  inSpan,
  privateLogExporter,
  privateSpanExporter,
} from "../utils/telemetry.js";

function wire(bridge: ReturnType<typeof createPuppeteerLogger>) {
  const send = bridge.logger("puppeteer:protocol:SEND ►")!;
  const receive = bridge.logger("puppeteer:protocol:RECV ◀")!;
  return {
    send: (frame: Record<string, unknown>) => send(JSON.stringify(frame)),
    receive: (frame: Record<string, unknown>) => receive(JSON.stringify(frame)),
  };
}

describe("Puppeteer CDP causal ownership", () => {
  let records: ReadableLogRecord[];
  let filter: string;
  const record = (marker: string) =>
    records.find((r) => String(r.body).includes(`"marker":"${marker}"`))!;

  beforeEach(() => {
    records = [];
    filter = debug.disable();
    debug.enable("puppeteer:*");
    jest
      .spyOn(privateLogExporter, "export")
      .mockImplementation((batch, done) => {
        records.push(...batch);
        done({ code: ExportResultCode.SUCCESS });
      });
    jest
      .spyOn(privateSpanExporter, "export")
      .mockImplementation((_batch, done) =>
        done({ code: ExportResultCode.SUCCESS }),
      );
  });
  afterEach(() => {
    debug.enable(filter);
    jest.restoreAllMocks();
  });

  it("routes interleaved replies and unsolicited sessions by real CDP ids, not delivery context", async () => {
    await inSpan("browser", async (browser) => {
      const lifetime = new AbortController();
      const bridge = createPuppeteerLogger(lifetime.signal);
      const { send, receive } = wire(bridge);
      const browserId = browser.spanContext().spanId;
      const owners: string[] = [];
      const ready = Promise.withResolvers<void>();
      await Promise.all(
        [0, 1].map((i) =>
          inSpan(`account-${i}`, async (span) => {
            owners[i] = span.spanContext().spanId;
            send({ id: i + 1, method: "Target.createBrowserContext" });
            if (i === 0) await ready.promise;
            else ready.resolve();
            receive({
              id: i + 1,
              result: { browserContextId: `context-${i}` },
            });
            receive({
              method: "Target.targetCreated",
              params: {
                targetInfo: {
                  targetId: `target-${i}`,
                  browserContextId: `context-${i}`,
                },
              },
            });
            receive({
              method: "Target.attachedToTarget",
              params: {
                sessionId: `session-${i}`,
                targetInfo: {
                  targetId: `target-${i}`,
                  browserContextId: `context-${i}`,
                },
              },
            });
            send({
              id: i + 10,
              sessionId: `session-${i}`,
              method: "Runtime.evaluate",
              marker: `send-${i}`,
            });
          }),
        ),
      );
      // Transport callback runs in an unrelated context, as it does in Puppeteer.
      await inSpan("unrelated", async () => {
        receive({
          id: 11,
          sessionId: "session-1",
          result: {},
          marker: "reply-1",
        });
        receive({ id: 10, result: {}, marker: "reply-0" });
        receive({
          sessionId: "session-0",
          method: "Page.frameNavigated",
          marker: "event-0",
        });
        receive({ method: "Browser.downloadProgress", marker: "unknown" });
        send({ id: 30, method: "Browser.getVersion", marker: "shared" });
      });
      await flushTelemetry();
      for (const i of [0, 1]) {
        expect(record(`send-${i}`).spanContext?.spanId).toBe(owners[i]);
        expect(record(`reply-${i}`).spanContext?.spanId).toBe(owners[i]);
      }
      expect(record("event-0").spanContext?.spanId).toBe(owners[0]);
      expect(record("unknown").spanContext?.spanId).toBe(browserId);
      expect(record("shared").spanContext?.spanId).toBe(browserId);
      expect(trace.getSpan(context.active())?.spanContext().spanId).toBe(
        browserId,
      );
      lifetime.abort();
    });
  });

  it("isolates browser connection ids, observes filtered control frames, and clears detached/cancelled ownership", async () => {
    await inSpan("browser", async (browser) => {
      const firstLifetime = new AbortController();
      const secondLifetime = new AbortController();
      const first = createPuppeteerLogger(firstLifetime.signal);
      const second = createPuppeteerLogger(secondLifetime.signal);
      const a = wire(first);
      const b = wire(second);
      const ownerIds: string[] = [];
      debug.enable("puppeteer:protocol:RECV*");
      for (const [i, connection] of [a, b].entries()) {
        await inSpan(`account-${i}`, async (span) => {
          ownerIds[i] = span.spanContext().spanId;
          connection.send({ id: 1, method: "Target.createBrowserContext" });
        });
      }
      a.receive({ id: 1, result: { browserContextId: "a" }, marker: "a" });
      b.receive({ id: 1, result: { browserContextId: "b" }, marker: "b" });
      a.receive({
        method: "Target.attachedToTarget",
        params: {
          sessionId: "session",
          targetInfo: { targetId: "target", browserContextId: "a" },
        },
      });
      a.send({ id: 2, method: "Runtime.evaluate", sessionId: "session" });
      a.receive({
        method: "Target.detachedFromTarget",
        params: { sessionId: "session" },
      });
      a.receive({ id: 2, sessionId: "session", marker: "detached-reply" });
      a.receive({
        sessionId: "session",
        method: "Runtime.consoleAPICalled",
        marker: "detached-event",
      });
      firstLifetime.abort();
      b.send({
        id: 3,
        method: "Target.createTarget",
        params: { browserContextId: "b" },
      });
      secondLifetime.abort();
      b.receive({
        id: 3,
        result: { targetId: "late" },
        marker: "after-cancel",
      });
      await flushTelemetry();
      expect(record("a").spanContext?.spanId).toBe(ownerIds[0]);
      expect(record("b").spanContext?.spanId).toBe(ownerIds[1]);
      for (const marker of [
        "detached-reply",
        "detached-event",
        "after-cancel",
      ]) {
        expect(record(marker).spanContext?.spanId).toBe(
          browser.spanContext().spanId,
        );
      }
      expect(
        records.some(
          (r) => r.attributes["log.namespace"] === "puppeteer:protocol:SEND ►",
        ),
      ).toBe(false);
    });
  });

  it("expires unanswered commands and never recaptures account ownership after abort", async () => {
    await inSpan("browser", async (browser) => {
      const lifetime = new AbortController();
      const bridge = createPuppeteerLogger(lifetime.signal);
      const connection = wire(bridge);
      const clock = jest.spyOn(Date, "now").mockReturnValue(1_000);
      await inSpan("account", async () => {
        connection.send({ id: 1, method: "Target.createBrowserContext" });
      });
      clock.mockReturnValue(601_001);
      connection.receive({
        id: 1,
        result: { browserContextId: "late" },
        marker: "expired",
      });
      lifetime.abort();
      await inSpan("other-account", async () => {
        connection.send({
          id: 2,
          method: "Target.createBrowserContext",
          marker: "disposed-send",
        });
      });
      connection.receive({
        id: 2,
        result: { browserContextId: "ignored" },
        marker: "disposed-reply",
      });
      await flushTelemetry();
      for (const marker of ["expired", "disposed-send", "disposed-reply"]) {
        expect(record(marker).spanContext?.spanId).toBe(
          browser.spanContext().spanId,
        );
      }
    });
  });

  it("keeps an already-aborted logger browser-scoped without registering cleanup", async () => {
    await inSpan("browser", async (browser) => {
      const signal = AbortSignal.abort();
      const listen = jest.spyOn(signal, "addEventListener");
      const connection = wire(createPuppeteerLogger(signal));
      await inSpan("account", async () => {
        connection.send({
          id: 1,
          method: "Target.createBrowserContext",
          marker: "already-aborted",
        });
      });
      await flushTelemetry();
      expect(listen).not.toHaveBeenCalled();
      expect(record("already-aborted").spanContext?.spanId).toBe(
        browser.spanContext().spanId,
      );
    });
  });

  it("correlates commands with their issuing child span without transferring background event ownership", async () => {
    await inSpan("browser", async () => {
      const lifetime = new AbortController();
      const bridge = createPuppeteerLogger(lifetime.signal);
      const { send, receive } = wire(bridge);
      let accountId: string;
      let operationId: string;
      await createLogger("scraper").span(
        {
          name: "account",
          attributes: { "account.index": 0, "account.company": "fixture" },
        },
        async (account) => {
          accountId = account.spanContext().spanId;
          send({ id: 1, method: "Target.createBrowserContext" });
          receive({ id: 1, result: { browserContextId: "context" } });
          await createLogger("scraper")
            .extend("fixture")
            .span({ name: "operation" }, async (operation) => {
              operationId = operation.spanContext().spanId;
              send({
                id: 2,
                method: "Target.createTarget",
                params: { browserContextId: "context" },
                marker: "create-target",
              });
            });
        },
      );
      receive({ id: 2, result: { targetId: "target" }, marker: "created" });
      receive({
        method: "Target.attachedToTarget",
        params: {
          sessionId: "session",
          targetInfo: { targetId: "target" },
        },
      });
      await inSpan("sibling-account", async () => {
        send({
          id: 3,
          method: "Runtime.evaluate",
          sessionId: "session",
          marker: "sibling-send",
        });
      });
      receive({ id: 3, result: {}, marker: "sibling-reply" });
      receive({
        sessionId: "session",
        method: "Runtime.consoleAPICalled",
        marker: "background",
      });
      await flushTelemetry();
      expect(record("create-target").spanContext?.spanId).toBe(operationId!);
      expect(record("created").spanContext?.spanId).toBe(operationId!);
      expect(record("background").spanContext?.spanId).toBe(accountId!);
      expect(record("sibling-send").spanContext?.spanId).toBe(accountId!);
      expect(record("sibling-reply").spanContext?.spanId).toBe(accountId!);
      lifetime.abort();
    });
  });
});
