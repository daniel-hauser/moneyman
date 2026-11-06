export const diagnosticTrace = "11111111111111111111111111111111";
export const otherTrace = "22222222222222222222222222222222";
export const ids = {
  root: "0000000000000001",
  first: "0000000000000002",
  second: "0000000000000003",
  storageA: "0000000000000004",
  storageB: "0000000000000005",
  orphan: "0000000000000006",
};
export const maliciousDiagnostic =
  '</template><script>globalThis.injected = true</script>&"';
export const multilineDiagnostic = `First line\n  continuation frame\n${maliciousDiagnostic}`;
export const rawConsole = "Invented raw console\r\n  raw continuation\r\n";
export const diagnosticTime = (offset: number) =>
  String(1704103200000000000n + BigInt(offset));
const attrs = (values: Record<string, string | number>) =>
  Object.entries(values).map(([key, value]) => ({
    key,
    value:
      typeof value === "number"
        ? { intValue: String(value) }
        : { stringValue: value },
  }));
const span = (
  spanId: string,
  name: string,
  parentSpanId: string,
  values: Record<string, string | number> = {},
  extra: Record<string, unknown> = {},
) => ({
  traceId: diagnosticTrace,
  spanId,
  name,
  parentSpanId,
  startTimeUnixNano: diagnosticTime(1),
  endTimeUnixNano: diagnosticTime(1000000000),
  attributes: attrs(values),
  ...extra,
});
const log = (
  body: string,
  spanId = "",
  traceId = diagnosticTrace,
  offset = 123456789,
) => ({
  traceId,
  spanId,
  timeUnixNano: diagnosticTime(offset),
  body: { stringValue: body },
  attributes: attrs({ "log.namespace": "moneyman:invented" }),
});

export function diagnosticFixture() {
  const completed = span(
    ids.first,
    "scraper.account",
    ids.root,
    {
      "account.company": "invented-bank",
      "account.index": 0,
      "invented.attribute": maliciousDiagnostic,
    },
    {
      droppedEventsCount: 3,
      events: [
        {
          name: "exception",
          timeUnixNano: diagnosticTime(400000000),
          attributes: attrs({
            "exception.type": "InventedError",
            "exception.message": "invented failure",
            "exception.stacktrace": "InventedError\n  at invented-frame",
          }),
        },
      ],
      status: { code: 2, message: "invented failure" },
    },
  );
  return (
    [
      // Logs arrive before and after the spans they belong to.
      JSON.stringify({
        resourceLogs: [
          {
            resource: {
              attributes: attrs({
                "thread.id": 7,
                "service.name": "invented-service",
              }),
            },
            scopeLogs: [
              {
                logRecords: [
                  log(multilineDiagnostic, ids.storageA),
                  log("Same company, second configured account", ids.second),
                  log("Parallel storage B", ids.storageB),
                  log("Unscoped startup", "", "", -100000000),
                  log("Orphan record", ids.orphan),
                  log("Other trace record", ids.first, otherTrace),
                ],
              },
            ],
          },
        ],
      }),
      JSON.stringify({
        resourceSpans: [
          {
            resource: { attributes: attrs({ "thread.name": "worker" }) },
            scopeSpans: [
              {
                spans: [
                  span(ids.root, "main.run", "", {
                    "run.id": "invented-run",
                    "run.trigger": "manual",
                  }),
                  completed,
                  span(ids.second, "scraper.account", ids.root, {
                    "account.company": "invented-bank",
                    "account.index": 1,
                  }),
                  span(ids.storageA, "storage.save", ids.first, {
                    "storage.name": "invented-A",
                  }),
                  span(ids.storageB, "storage.save", ids.first, {
                    "storage.name": "invented-B",
                  }),
                  {
                    ...span(ids.root, "main.run", "", {
                      "run.id": "other-run",
                    }),
                    traceId: otherTrace,
                  },
                  {
                    ...completed,
                    endTimeUnixNano: "0",
                    events: [],
                    droppedEventsCount: 0,
                  },
                ],
              },
            ],
          },
        ],
      }),
      JSON.stringify({
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  log(
                    "after exported span",
                    ids.storageA,
                    diagnosticTrace,
                    999999999,
                  ),
                ],
              },
            ],
          },
        ],
      }),
      "{malformed invented row",
      JSON.stringify({ unknown: "invented unsupported row" }),
      JSON.stringify({
        resourceLogs: [
          {
            scopeLogs: [
              {
                logRecords: [
                  null,
                  log("survives malformed neighbor", ids.second),
                ],
              },
            ],
          },
        ],
      }),
    ].join("\n") + "\n"
  );
}
