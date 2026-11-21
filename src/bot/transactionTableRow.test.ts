import { tableRow } from "./transactionTableRow.js";
import { TransactionRow } from "../types.js";
import { CompanyTypes } from "israeli-bank-scrapers";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { transaction } from "../utils/tests.js";

// Mock the config module to avoid ACCOUNTS_JSON requirement
jest.mock("../config.js", () => ({
  systemName: "test-system",
  config: {
    options: {
      scraping: {
        transactionHashType: "",
      },
    },
  },
}));

// Helper to create a TransactionRow using existing test utility
const createMockTransactionRow = (
  overrides: Partial<TransactionRow> = {},
): TransactionRow => ({
  ...transaction({
    status: TransactionStatuses.Completed,
  }),
  account: "test-account",
  scrapedAt: "2026-01-30T12:00:00.000Z",
  companyId: CompanyTypes.hapoalim,
  hash: "test-hash",
  uniqueId: "test-unique-id",
  ...overrides,
});

describe("transactionTableRow", () => {
  describe("tableRow", () => {
    it("should use tx.hash when transactionHashType is not 'moneyman'", () => {
      const mockTransaction = createMockTransactionRow({
        hash: "test-hash",
        uniqueId: "test-unique-id",
      });

      const result = tableRow(mockTransaction);

      expect(result.hash).toBe("test-hash");
    });

    it("should use tx.uniqueId when transactionHashType is 'moneyman'", () => {
      const mockTransaction = createMockTransactionRow({
        hash: "test-hash",
        uniqueId: "test-unique-id",
      });

      const result = tableRow(mockTransaction, false, "moneyman");

      expect(result.hash).toBe("test-unique-id");
    });

    it("includes raw transaction data only when requested", () => {
      const tx = createMockTransactionRow({ memo: "Test memo" });
      expect(tableRow(tx, true).raw).toBe(JSON.stringify(tx));
      expect(tableRow(tx, false)).not.toHaveProperty("raw");
      expect(tableRow(tx)).not.toHaveProperty("raw");
    });

    it("should include all other required fields", () => {
      const mockTransaction = createMockTransactionRow({
        date: new Date(2026, 0, 30).toISOString(),
        chargedAmount: 100,
        description: "Test transaction",
        memo: "Test memo",
        identifier: "test-id",
      });

      const result = tableRow(mockTransaction);

      expect(result.date).toBe("30/01/2026");
      expect(result.amount).toBe(100);
      expect(result.description).toBe("Test transaction");
      expect(result.memo).toBe("Test memo");
      expect(result.category).toBe("");
      expect(result.account).toBe("test-account");
      expect(result.hash).toBe("test-hash");
      expect(result.comment).toBe("");
      expect(result["scraped at"]).toBeDefined();
      expect(result["scraped by"]).toBe("test-system");
      expect(result.identifier).toBe("test-id");
      expect(result.chargedCurrency).toBe("ILS");
    });

    it("preserves the local scrape date when exporting after midnight", () => {
      jest.useFakeTimers();
      try {
        const beforeMidnight = new Date(2026, 0, 30, 23, 59);
        jest.setSystemTime(beforeMidnight);
        const tx = createMockTransactionRow({
          scrapedAt: beforeMidnight.toISOString(),
        });
        expect(tableRow(tx)["scraped at"]).toBe("2026-01-30");

        jest.setSystemTime(new Date(2026, 0, 31, 0, 1));
        expect(tableRow(tx)["scraped at"]).toBe("2026-01-30");
        const nextRun = createMockTransactionRow({
          scrapedAt: new Date().toISOString(),
        });
        expect(tableRow(nextRun)["scraped at"]).toBe("2026-01-31");
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
