import { CompanyTypes } from "israeli-bank-scrapers";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { createStorages, saveResults } from "./index.js";
import { createRunReport } from "../runReport.js";
import { config, transaction } from "../../utils/tests.js";
import { MoneymanDashStorage } from "./moneyman.js";
import { WebPostStorage } from "./web-post.js";
import type { MoneymanConfig } from "../../config.schema.js";
import { runContextStore } from "../../utils/asyncContext.js";
import type { TransactionStorage } from "../../types.js";
import { createSaveStats } from "../saveStats.js";

jest.mock("../../config.js", () => ({ systemName: "moneyman" }));
jest.mock("../notifier.js", () => ({
  sendError: jest.fn(),
  sendJSON: jest.fn(),
}));
jest.mock("google-spreadsheet", () => ({ GoogleSpreadsheet: jest.fn() }));
jest.mock("azure-kusto-data", () => ({}));
jest.mock("azure-kusto-ingest", () => ({}));
jest.mock("@actual-app/api", () => ({}));

function snapshot(secret: string): MoneymanConfig {
  const result = config();
  const token = `mm_${Buffer.from(
    JSON.stringify({
      u: `https://${secret}.test/ingest`,
      k: secret,
    }),
  ).toString("base64url")}`;
  result.storage = {
    webPost: { url: `https://${secret}.test/post`, authorizationToken: secret },
    moneyman: { token },
  };
  return result;
}

describe("storage waterfall timings", () => {
  afterEach(() => jest.restoreAllMocks());

  it("captures parallel storage execution and sequential progress steps, including failures", async () => {
    let now = 1_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    class TimedStorage implements TransactionStorage {
      canSave = () => true;
      constructor(private readonly fail: boolean) {}
      async saveTransactions(
        txns: Parameters<TransactionStorage["saveTransactions"]>[0],
        progress: Parameters<TransactionStorage["saveTransactions"]>[1],
      ) {
        await progress("connect");
        await (this.fail ? second.promise : first.promise);
        await progress("write");
        if (this.fail) throw new Error("storage failed");
        return createSaveStats("TimedStorage", undefined, txns, { added: 1 });
      }
    }
    const report = createRunReport();
    const run = saveResults(
      [
        {
          companyId: CompanyTypes.hapoalim,
          result: {
            success: true,
            accounts: [{ accountNumber: "123", txns: [transaction({})] }],
          },
        },
      ],
      report,
      [new TimedStorage(false), new TimedStorage(true)],
    );
    const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
    await tick();
    expect(report.timings).toHaveLength(4);
    expect(
      report.timings!.every(
        ({ startedAt, endedAt }) =>
          startedAt === 1_000 && endedAt === undefined,
      ),
    ).toBe(true);

    now = 1_100;
    first.resolve();
    await tick();
    now = 1_200;
    second.resolve();
    await run;

    const parents = report.timings!.filter(({ kind }) => kind === "storage");
    expect(
      parents.map(({ startedAt, endedAt, failed }) => ({
        startedAt,
        endedAt,
        failed,
      })),
    ).toEqual([
      { startedAt: 1_000, endedAt: 1_100, failed: undefined },
      { startedAt: 1_000, endedAt: 1_200, failed: true },
    ]);
    expect(new Set(report.timings!.map(({ id }) => id)).size).toBe(6);
    for (const parent of parents) {
      const steps = report.timings!.filter(
        ({ parentId }) => parentId === parent.id,
      );
      expect(steps.map(({ name }) => name)).toEqual(["connect", "write"]);
      expect(steps[0]).toMatchObject({
        startedAt: 1_000,
        endedAt: parent.endedAt,
      });
      expect(steps[0].failed).toBeUndefined();
      expect(steps[1]).toMatchObject({
        startedAt: parent.endedAt,
        endedAt: parent.endedAt,
        ...(parent.failed ? { failed: true } : {}),
      });
    }
    expect(report.storages.TimedStorage).toEqual({
      state: "error",
      message: "storage failed",
    });
  });

  it("retains storage stats and monotonic step durations and initializes legacy reports lazily", async () => {
    const report = createRunReport();
    delete report.timings;
    const storage: TransactionStorage = {
      canSave: () => true,
      async saveTransactions(txns, progress) {
        await progress("write");
        return createSaveStats("Object", undefined, txns, { added: 1 });
      },
    };
    await saveResults(
      [
        {
          companyId: CompanyTypes.hapoalim,
          result: {
            success: true,
            accounts: [{ accountNumber: "123", txns: [transaction({})] }],
          },
        },
      ],
      report,
      [storage],
    );
    expect(report.storages.Object).toMatchObject({
      state: "done",
      durationMs: expect.any(Number),
      stats: { added: 1 },
      steps: [{ name: "write", durationMs: expect.any(Number) }],
    });
    expect(report.timings).toHaveLength(2);
    expect(report.timings!.every(({ endedAt }) => endedAt !== undefined)).toBe(
      true,
    );
  });
});

describe("per-run storage ownership", () => {
  const fetchMock = jest.fn<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >();
  const originalFetch = global.fetch;
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            transactionsAdded: 1,
            added: 1,
          }),
        ),
    );
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("constructs independent clients and uses fresh HTTP credentials for transaction saves and log uploads", async () => {
    const first = createStorages(snapshot("first"));
    const second = createStorages(snapshot("second"));
    expect(first.map((s) => s.constructor.name)).toEqual([
      "WebPostStorage",
      "MoneymanDashStorage",
    ]);
    expect(second[0]).not.toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    const results = [
      {
        companyId: CompanyTypes.hapoalim,
        result: {
          success: true,
          accounts: [{ accountNumber: "123", txns: [transaction({})] }],
        },
      },
    ];

    await saveResults(results, createRunReport(), first);
    await saveResults(results, createRunReport(), second);
    for (const [clients, secret] of [
      [first, "first"],
      [second, "second"],
    ] as const) {
      const dash = clients.find(
        (s): s is MoneymanDashStorage => s instanceof MoneymanDashStorage,
      )!;
      await runContextStore.run({ runId: "test-run" }, () =>
        dash.sendLogs("test logs"),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        `https://${secret}.test/post`,
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: secret }),
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        `https://${secret}.test/ingest`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${secret}`,
          }),
        }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        `https://${secret}.test/ingest/logs`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${secret}`,
          }),
        }),
      );
    }
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://first.test/post",
      "https://first.test/ingest",
      "https://second.test/post",
      "https://second.test/ingest",
      "https://first.test/ingest/logs",
      "https://second.test/ingest/logs",
    ]);
  });

  it("applies the new run's storage selection rather than retaining old clients", () => {
    const first = createStorages(snapshot("first"));
    const next = snapshot("next");
    next.storage = { localJson: { enabled: false } };
    expect(createStorages(next)).toEqual([]);
    expect(first[0]).toBeInstanceOf(WebPostStorage);
  });

  it("applies per-run transaction hash options in storage providers", async () => {
    const fresh = snapshot("fresh");
    fresh.options.scraping.transactionHashType = "";
    const next = structuredClone(fresh);
    next.options.scraping.transactionHashType = "moneyman";
    const report = createRunReport();
    const results = [
      {
        companyId: CompanyTypes.hapoalim,
        result: {
          success: true,
          accounts: [
            {
              accountNumber: "123",
              txns: [transaction({ status: TransactionStatuses.Completed })],
            },
          ],
        },
      },
    ];
    await saveResults(results, report, createStorages(fresh));
    await saveResults(results, createRunReport(), createStorages(next));
    expect(report.storages.WebPostStorage.state).toBe("done");
    expect(report.storages.MoneymanDashStorage.state).toBe("done");
    const posts = fetchMock.mock.calls.filter(
      ([url]) => url === "https://fresh.test/post",
    );
    const [oldRow] = JSON.parse(posts[0][1]!.body as string);
    const [newRow] = JSON.parse(posts[1][1]!.body as string);
    expect(oldRow.hash).not.toBe(newRow.hash);
    expect(newRow.hash).toContain("2026-01-30_hapoalim_123");
  });
});
