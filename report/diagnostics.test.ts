/** @jest-environment ./report/test-environment.cjs */
import { Blob, Buffer } from "node:buffer";
import {
  effectiveAttributes,
  elapsedMs,
  parseDiagnostics,
  queryDiagnostics,
  spanAncestors,
  timestamp,
} from "../src/bot/report/diagnostics.js";
import type { ReportDiagnostics } from "../src/bot/report/diagnostics-element.js";
import { renderReportDiagnostics } from "../src/bot/report/components.js";
import { createRunReport, renderHTMLReport } from "../src/bot/runReport.js";
import { reportClientScript } from "../src/bot/report/assets.generated.js";
import {
  diagnosticFixture,
  diagnosticTime,
  diagnosticTrace,
  otherTrace,
  ids,
  maliciousDiagnostic,
  multilineDiagnostic,
  rawConsole,
} from "./diagnostics-fixture.js";

declare function createReportWindow(): Window & typeof globalThis;
const operation = (id: string) => `${diagnosticTrace}/${id}`;

describe("structured diagnostic normalization and queries", () => {
  const data = parseDiagnostics(diagnosticFixture());
  const spans = new Map(data.spans.map((span) => [span.key, span]));
  it("joins late spans, prefers completed snapshots and preserves nanosecond deltas", () => {
    expect(data.spans).toHaveLength(6);
    expect(spans.get(operation(ids.first))?.status).toBe(
      "error: invented failure",
    );
    expect(data.droppedEvents).toBe(3);
    expect(data.warnings).toHaveLength(3);
    expect(timestamp(diagnosticTime(1))).toBe("2024-01-01T10:00:00.000Z");
    expect(elapsedMs(diagnosticTime(1), diagnosticTime(0))).toBe(0.000001);
    expect(elapsedMs(diagnosticTime(999999999), diagnosticTime(0))).toBe(
      999.999999,
    );
    expect(
      data.events.find((event) => event.body === multilineDiagnostic)?.body,
    ).toBe(multilineDiagnostic);
    expect(
      spanAncestors(operation(ids.storageA), spans).map((span) => span.spanId),
    ).toEqual([ids.root, ids.first, ids.storageA]);
  });

  it("inherits operation attributes and resource metadata without assigning orphans", () => {
    const event = data.events.find(
      (event) => event.body === multilineDiagnostic,
    )!;
    expect(effectiveAttributes(event, spans)).toMatchObject({
      "account.company": "invented-bank",
      "account.index": "0",
      "storage.name": "invented-A",
      "run.id": "invented-run",
      "thread.id": "7",
      "thread.name": "worker",
      "service.name": "invented-service",
      "invented.attribute": maliciousDiagnostic,
    });
    expect(
      effectiveAttributes(
        data.events.find((event) => event.body === "Orphan record")!,
        spans,
      )["account.company"],
    ).toBeUndefined();
    expect(
      queryDiagnostics(data, { facets: { "account.index": "1" } }).every(
        (event) => event.ownerKey === operation(ids.second),
      ),
    ).toBe(true);
    expect(
      queryDiagnostics(data, {
        type: "log",
        facets: {
          "account.company": "invented-bank",
          "account.index": "0",
          "storage.name": "invented-A",
          "log.namespace": "moneyman:invented",
        },
      }).map((event) => event.body),
    ).toEqual([multilineDiagnostic, "after exported span"]);
    expect(
      queryDiagnostics(data, {
        facets: { "storage.name": "invented-B" },
        term: "First line",
      }),
    ).toEqual([]);
  });

  it("ANDs subtree, trace, record and wildcard filters across whole multiline events", () => {
    expect(
      queryDiagnostics(data, {
        operation: operation(ids.first),
        type: "log",
      }).map((event) => event.body),
    ).toEqual([
      multilineDiagnostic,
      "Parallel storage B",
      "after exported span",
    ]);
    expect(
      queryDiagnostics(data, {
        operation: operation(ids.first),
        descendants: false,
        type: "log",
      }),
    ).toEqual([]);
    expect(
      queryDiagnostics(data, { traceId: otherTrace, type: "log" }).map(
        (event) => event.body,
      ),
    ).toEqual(["Other trace record"]);
    expect(
      queryDiagnostics(data, {
        term: "FIRST LINE*continuation frame",
        type: "log",
      }).map((event) => event.body),
    ).toEqual([multilineDiagnostic]);
    expect(
      queryDiagnostics(data, {
        term: "InventedError*invented-frame",
        type: "exception",
      }),
    ).toHaveLength(1);
    expect(
      queryDiagnostics(data, { term: "thread.id*7", type: "log" }),
    ).toHaveLength(6);
    expect(
      queryDiagnostics(data, { type: "failure" }).some(
        (event) => event.type === "exception",
      ),
    ).toBe(true);
    expect(queryDiagnostics(data, { type: "failure" })).toHaveLength(2);
    expect(
      queryDiagnostics(data, { type: "log" }).every(
        (event) => !("log.severity" in event.attributes),
      ),
    ).toBe(true);
  });

  it("handles event-only, running, malformed, cyclic and empty histories explicitly", () => {
    const running = parseDiagnostics(
      JSON.stringify({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: "trace",
                    spanId: "span",
                    parentSpanId: "span",
                    name: "running",
                    startTimeUnixNano: diagnosticTime(0),
                    endTimeUnixNano: "0",
                    events: [
                      {
                        name: "only event",
                        timeUnixNano: diagnosticTime(10),
                        attributes: [
                          {
                            key: "step",
                            value: { stringValue: "invented step" },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(running.spans[0].end).toBeUndefined();
    expect(running.spans[0].status).toBe("running");
    expect(running.events).toHaveLength(2);
    expect(running.events[1].body).toBe("only event · invented step");
    expect(
      spanAncestors(
        "trace/span",
        new Map(running.spans.map((span) => [span.key, span])),
      ),
    ).toHaveLength(1);
    expect(parseDiagnostics("").events).toEqual([]);
    expect(parseDiagnostics("null\n[]\n{}").warnings).toHaveLength(3);
    const logOnly = parseDiagnostics(diagnosticFixture().split("\n")[0]);
    expect(logOnly.spans).toEqual([]);
    expect(logOnly.events).toHaveLength(6);
  });
});

describe("offline diagnostics explorer", () => {
  async function browser() {
    const source = diagnosticFixture();
    const data = parseDiagnostics(source);
    const realm = createReportWindow();
    const { document } = realm;
    document.body.innerHTML = renderReportDiagnostics(
      { console: rawConsole, telemetry: source },
      data,
    );
    const fetch = jest.fn();
    const XMLHttpRequest = jest.fn();
    Object.assign(realm, {
      fetch,
      XMLHttpRequest,
      Highlight: Set,
      CSS: { highlights: { set: jest.fn() } },
    });
    realm.eval(reportClientScript);
    const element =
      document.querySelector<ReportDiagnostics>("report-diagnostics")!;
    await element.ready();
    await document
      .querySelector<{ ready(): Promise<void> } & HTMLElement>("report-logs")!
      .ready();
    await Promise.resolve();
    const select = async (id: string, value: string) => {
      const input = document.getElementById(id) as HTMLSelectElement;
      input.value = value;
      input.dispatchEvent(new realm.Event("change", { bubbles: true }));
      await element.ready();
    };
    const search = async (value: string) => {
      const input = document.querySelector<HTMLInputElement>(
        "#search-diagnostics",
      )!;
      input.value = value;
      input.dispatchEvent(new realm.Event("input", { bubbles: true }));
      await element.ready();
    };
    const bodies = () =>
      [...document.querySelectorAll(".diagnostic-body")].map(
        (node) => node.textContent,
      );
    return {
      realm,
      document,
      element,
      select,
      search,
      bodies,
      fetch,
      XMLHttpRequest,
      source,
    };
  }

  it("renders a readable escaped SSR event timeline with connected operation context", () => {
    const source = diagnosticFixture();
    const output = renderReportDiagnostics(
      { console: rawConsole, telemetry: source },
      parseDiagnostics(source),
    );
    document.body.innerHTML = output;
    expect(
      document.querySelector(".diagnostic-operations")?.textContent,
    ).toContain("scraper.account · invented-bank · account 0");
    expect(document.querySelector("#diagnostics-count")?.textContent).toBe(
      "(21 of 21 events)",
    );
    expect(document.querySelectorAll(".diagnostic-body")).toHaveLength(21);
    expect(document.querySelectorAll("script")).toHaveLength(0);
    expect(
      document.querySelector<HTMLSelectElement>("#facet-account-index")!.value,
    ).toBe("");
    expect(document.body.textContent).toContain(maliciousDiagnostic);
    expect(output).not.toContain(maliciousDiagnostic);
    expect(
      document.querySelector("report-diagnostics")!.innerHTML,
    ).toMatchSnapshot();
  });

  it("filters real bundled UI by exact account/storage/subtree without losing multiline events or parent context", async () => {
    const page = await browser();
    await page.select("diagnostic-trace", diagnosticTrace);
    await page.select("facet-account-company", "invented-bank");
    await page.select("facet-account-index", "0");
    await page.select("facet-storage-name", "invented-A");
    await page.select("diagnostic-type", "log");
    expect(page.bodies()).toEqual([multilineDiagnostic, "after exported span"]);
    await page.search("FIRST LINE*continuation frame");
    expect(page.bodies()).toEqual([multilineDiagnostic]);
    await page.search("");
    await page.select("diagnostic-operation", operation(ids.first));
    expect(
      page.document.querySelector(".diagnostic-context")!.textContent,
    ).toContain("main.run → scraper.account · invented-bank · account 0");
    expect(
      page.document.querySelectorAll(".diagnostic-operations li"),
    ).toHaveLength(5);
    const checkbox = page.document.querySelector<HTMLInputElement>(
      "#diagnostic-descendants",
    )!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new page.realm.Event("change", { bubbles: true }));
    await page.element.ready();
    expect(page.bodies()).toEqual([]);
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.XMLHttpRequest).not.toHaveBeenCalled();
    expect(page.realm).not.toHaveProperty("injected");
    expect(page.document.querySelector("#run-logs code")!.textContent).toBe(
      rawConsole,
    );
    page.document
      .querySelector<HTMLButtonElement>("#diagnostics-reset")!
      .click();
    await page.element.ready();
    expect(page.bodies()).toHaveLength(21);
    expect(
      page.document.querySelector<HTMLSelectElement>("#facet-account-index")!
        .value,
    ).toBe("");
    expect(
      page.document.querySelector<HTMLSelectElement>("#diagnostic-operation")!
        .value,
    ).toBe("");
    page.realm.close();
  });

  it("downloads unfiltered original sources and valid normalized JSON after filtering", async () => {
    const page = await browser();
    const blobs: Blob[] = [];
    Object.assign(page.realm, {
      Blob,
      URL: {
        createObjectURL(blob: Blob) {
          blobs.push(blob);
          return "blob:invented";
        },
        revokeObjectURL: jest.fn(),
      },
    });
    jest
      .spyOn(page.realm.HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    await page.search("no matching invented event");
    expect(page.bodies()).toEqual([]);
    for (const id of ["diagnostics-json", "telemetry-json", "logs-json"])
      page.document
        .querySelector<HTMLButtonElement>(`[data-download="${id}"]`)!
        .click();
    const contents = await Promise.all(
      blobs.map(async (blob) =>
        Buffer.from(await blob.arrayBuffer()).toString("utf8"),
      ),
    );
    expect(JSON.parse(contents[0])).toEqual(parseDiagnostics(page.source));
    expect(contents[1]).toBe(page.source);
    expect(contents[2]).toBe(rawConsole);
    page.realm.close();
  });

  it("replaces disconnected timings with actual recorded span navigation, retaining legacy fallback and CSP", () => {
    const report = createRunReport(new Date("2024-01-01T10:00:00Z"));
    report.timings = [
      {
        id: "legacy",
        name: "legacy timing",
        kind: "scraper",
        startedAt: report.startedAt.getTime(),
        endedAt: report.startedAt.getTime() + 1,
      },
    ];
    const html = renderHTMLReport(report, {
      console: rawConsole,
      telemetry: diagnosticFixture(),
    });
    expect(html).toContain("report-diagnostics");
    expect(html).not.toContain("legacy timing");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("script-src-attr 'none'");
    expect(renderHTMLReport(report, rawConsole)).toContain("legacy timing");
    expect(renderHTMLReport(report, rawConsole)).not.toContain(
      "<report-diagnostics",
    );
  });
});
