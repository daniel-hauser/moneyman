import fs from "node:fs/promises";
import { Readable } from "node:stream";
import type { IngestClient } from "azure-kusto-ingest";
import { CompanyTypes } from "israeli-bank-scrapers";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { createStorages, saveResults } from "./index.js";
import { createRunReport } from "../runReport.js";
import { config, transaction, transactionRow } from "../../utils/tests.js";
import { MoneymanDashStorage } from "./moneyman.js";
import { WebPostStorage } from "./web-post.js";
import { LocalJsonStorage } from "./json.js";
import { TelegramStorage } from "./telegram.js";
import { AzureDataExplorerStorage } from "./azure-data-explorer.js";
import { sendJSON } from "../notifier.js";
import type { MoneymanConfig } from "../../config.schema.js";
import { runContextStore } from "../../utils/asyncContext.js";
import type { TransactionStorage } from "../../types.js";
import { createSaveStats, getSkippedCount } from "../saveStats.js";
import { mock } from "jest-mock-extended";

const mockIngestClient = mock<IngestClient>();
jest.mock("node:fs/promises", () => ({
  __esModule: true,
  default: { mkdir: jest.fn(), appendFile: jest.fn() },
}));
jest.mock("../../config.js", () => ({ systemName: "moneyman" }));
jest.mock("../notifier.js", () => ({
  sendError: jest.fn(),
  sendJSON: jest.fn(),
}));
jest.mock("google-spreadsheet", () => ({ GoogleSpreadsheet: jest.fn() }));
jest.mock("azure-kusto-data", () => ({
  KustoConnectionStringBuilder: {
    withAadApplicationKeyAuthentication: jest.fn(),
  },
}));
jest.mock("azure-kusto-ingest", () => ({
  DataFormat: { MULTIJSON: "multijson" },
  IngestionProperties: jest.fn(),
  IngestClient: jest.fn(() => mockIngestClient),
}));
jest.mock("@actual-app/api", () => ({}));

describe("storage pending policy", () => {
  it.each([
    {
      supportsPendingTransactions: undefined,
      completed: true,
      added: 1,
      pending: 1,
    },
    {
      supportsPendingTransactions: false,
      completed: true,
      added: 1,
      pending: 1,
    },
    {
      supportsPendingTransactions: undefined,
      completed: false,
      added: 0,
      pending: 1,
    },
    {
      supportsPendingTransactions: true,
      completed: true,
      added: 2,
      pending: 0,
    },
    {
      supportsPendingTransactions: true,
      completed: false,
      added: 1,
      pending: 0,
    },
  ])(
    "filters and reports $supportsPendingTransactions with completed=$completed",
    async ({ supportsPendingTransactions, completed, added, pending }) => {
      const storage = mock<TransactionStorage>({ supportsPendingTransactions });
      storage.saveTransactions.mockImplementation(async (txns) =>
        createSaveStats("test", undefined, txns, {
          added: txns.length,
          pending: 0,
        }),
      );
      const txns = [
        transaction({ status: TransactionStatuses.Pending }),
        completed ? transaction({}) : undefined,
      ].filter((tx) => tx !== undefined);
      const report = createRunReport();

      await saveResults(
        [
          {
            companyId: CompanyTypes.hapoalim,
            result: {
              success: true,
              accounts: [{ accountNumber: "123", txns }],
            },
          },
        ],
        report,
        [storage],
      );

      expect(storage.saveTransactions).toHaveBeenCalledTimes(1);
      expect(storage.saveTransactions.mock.calls[0][0]).toHaveLength(added);
      if (supportsPendingTransactions !== true) {
        expect(
          storage.saveTransactions.mock.calls[0][0].every(
            (tx) => tx.status !== TransactionStatuses.Pending,
          ),
        ).toBe(true);
      }
      expect(storage.saveTransactions.mock.calls[0][2]).toMatchObject({
        accountResults: [{ txnCount: txns.length }],
      });
      expect(report.storages.Object).toMatchObject({
        state: "done",
        stats: {
          total: txns.length,
          added,
          pending,
          existing: 0,
          otherSkipped: 0,
        },
      });
    },
  );
});

describe("pending transaction archives", () => {
  it.each(["json", "telegram", "azure"] as const)(
    "%s saves pending rather than reporting it skipped",
    async (provider) => {
      const cfg = config();
      cfg.storage.azure = {
        appId: "test-app",
        appKey: "test-key",
        tenantId: "test-tenant",
        databaseName: "test-db",
        tableName: "test-table",
        ingestionMapping: "test-mapping",
        ingestUri: "https://ingest.example.test",
      };
      const storage = {
        json: () => new LocalJsonStorage(cfg),
        telegram: () => new TelegramStorage(cfg),
        azure: () => new AzureDataExplorerStorage(cfg),
      }[provider]();
      const report = createRunReport();
      await saveResults(
        [
          {
            companyId: CompanyTypes.hapoalim,
            result: {
              success: true,
              accounts: [
                {
                  accountNumber: "123",
                  txns: [
                    transaction({ status: TransactionStatuses.Pending }),
                    transaction({}),
                  ],
                },
              ],
            },
          },
        ],
        report,
        [storage],
      );

      const result = report.storages[storage.constructor.name];
      expect(result.state).toBe("done");
      if (result.state !== "done") throw new Error("Archive save failed");
      expect(result.stats).toMatchObject({ total: 2, added: 2, pending: 0 });
      expect(getSkippedCount(result.stats)).toBe(0);

      const expectedTransactions = [
        expect.objectContaining({ status: TransactionStatuses.Pending }),
        expect.objectContaining({ status: TransactionStatuses.Completed }),
      ];
      if (provider === "json") {
        const serialized = jest.mocked(fs.appendFile).mock.calls[0][1];
        expect(JSON.parse(String(serialized))).toEqual(expectedTransactions);
      } else if (provider === "telegram") {
        expect(sendJSON).toHaveBeenCalledWith(
          {
            metadata: expect.objectContaining({ added: 2, pending: 0 }),
            transactions: expectedTransactions,
          },
          "transactions.txt",
        );
      } else {
        const stream = mockIngestClient.ingestFromStream.mock.calls[0][0];
        expect(stream).toBeInstanceOf(Readable);
        if (!(stream instanceof Readable)) throw new Error("Expected stream");
        let serialized = "";
        for await (const chunk of stream) serialized += chunk;
        expect(
          JSON.parse(serialized).map(
            (row: { transaction: unknown }) => row.transaction,
          ),
        ).toEqual(expectedTransactions);
      }
    },
  );
});

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
          signal: expect.any(AbortSignal),
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

  it.each(["web-post", "moneyman"] as const)(
    "filters pending transactions centrally before %s saves",
    async (provider) => {
      const cfg = snapshot("filtered");
      const storage =
        provider === "web-post"
          ? new WebPostStorage(cfg)
          : new MoneymanDashStorage(cfg);
      const report = createRunReport();
      await saveResults(
        [
          {
            companyId: CompanyTypes.hapoalim,
            result: {
              success: true,
              accounts: [
                {
                  accountNumber: "123",
                  txns: [
                    transaction({}),
                    transaction({ status: TransactionStatuses.Pending }),
                  ],
                },
              ],
            },
          },
        ],
        report,
        [storage],
      );

      const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      const rows = Array.isArray(payload) ? payload : payload.transactions;
      expect(rows).toHaveLength(1);
      expect(report.storages[storage.constructor.name]).toMatchObject({
        state: "done",
        stats: { total: 2, added: 1, pending: 1, otherSkipped: 0 },
      });
    },
  );

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
