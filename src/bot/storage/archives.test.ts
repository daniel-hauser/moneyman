import fs from "node:fs/promises";
import { Readable } from "node:stream";
import type { IngestClient } from "azure-kusto-ingest";
import { mock } from "jest-mock-extended";
import { CompanyTypes } from "israeli-bank-scrapers";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { config, transaction } from "../../utils/tests.js";
import { createRunReport } from "../runReport.js";
import { sendJSON } from "../notifier.js";
import { getSkippedCount } from "../saveStats.js";
import { LocalJsonStorage } from "./json.js";
import { TelegramStorage } from "./telegram.js";
import { AzureDataExplorerStorage } from "./azure-data-explorer.js";
import { saveResults } from "./index.js";

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
jest.mock("google-spreadsheet", () => ({ GoogleSpreadsheet: jest.fn() }));
jest.mock("@actual-app/api", () => ({}));

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
