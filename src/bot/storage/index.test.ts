import { CompanyTypes } from "israeli-bank-scrapers";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { createStorages, saveResults } from "./index.js";
import { createRunReport } from "../runReport.js";
import { config, transaction } from "../../utils/tests.js";
import { MoneymanDashStorage } from "./moneyman.js";
import { WebPostStorage } from "./web-post.js";
import type { MoneymanConfig } from "../../config.schema.js";
import { runContextStore } from "../../utils/asyncContext.js";

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
