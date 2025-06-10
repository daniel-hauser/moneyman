import { tableRow, TableHeaders } from "./transactionTableRow.js";
import { TransactionRow } from "../types.js";
import { CompanyTypes } from "israeli-bank-scrapers";
import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";

// Mock the config module to avoid ACCOUNTS_JSON requirement
jest.mock("../config.js", () => ({
  systemName: "test-system",
}));

const mockTransactionRow: TransactionRow = {
  date: "2023-01-01T00:00:00.000Z",
  processedDate: "2023-01-01T00:00:00.000Z",
  chargedAmount: 100,
  description: "Test transaction",
  memo: "Test memo",
  originalAmount: 100,
  originalCurrency: "ILS",
  identifier: "test-id",
  status: TransactionStatuses.Completed,
  type: TransactionTypes.Normal,
  account: "test-account",
  companyId: CompanyTypes.hapoalim,
  hash: "test-hash",
  uniqueId: "test-unique-id",
};

describe("transactionTableRow", () => {
  describe("TableHeaders", () => {
    it("should include raw column", () => {
      expect(TableHeaders).toContain("raw");
    });

    it("should have raw as the last column", () => {
      expect(TableHeaders[TableHeaders.length - 1]).toBe("raw");
    });
  });

  describe("tableRow", () => {
    beforeEach(() => {
      // Clean up environment variables to avoid interference
      delete process.env.RAW_TRANSACTION_DATA_ENABLED;
    });

    afterEach(() => {
      // Clean up environment variables
      delete process.env.RAW_TRANSACTION_DATA_ENABLED;
    });

    it("should include raw field when RAW_TRANSACTION_DATA_ENABLED is true (default)", () => {
      const result = tableRow(mockTransactionRow);

      expect(result.raw).toBeDefined();
      expect(result.raw).toBe(JSON.stringify(mockTransactionRow));
    });

    it("should include raw field when RAW_TRANSACTION_DATA_ENABLED is explicitly set to true", () => {
      process.env.RAW_TRANSACTION_DATA_ENABLED = "true";

      const result = tableRow(mockTransactionRow);

      expect(result.raw).toBeDefined();
      expect(result.raw).toBe(JSON.stringify(mockTransactionRow));
    });

    it("should not include raw field when RAW_TRANSACTION_DATA_ENABLED is false", () => {
      process.env.RAW_TRANSACTION_DATA_ENABLED = "false";

      const result = tableRow(mockTransactionRow);

      expect(result.raw).toBeUndefined();
    });

    it("should include all other required fields regardless of raw setting", () => {
      process.env.RAW_TRANSACTION_DATA_ENABLED = "false";

      const result = tableRow(mockTransactionRow);

      expect(result.date).toBeDefined();
      expect(result.amount).toBe(100);
      expect(result.description).toBe("Test transaction");
      expect(result.memo).toBe("Test memo");
      expect(result.category).toBe("");
      expect(result.account).toBe("test-account");
      expect(result.hash).toBeDefined();
      expect(result.comment).toBe("");
      expect(result["scraped at"]).toBeDefined();
      expect(result["scraped by"]).toBeDefined();
      expect(result.identifier).toBe("test-id");
      expect(result.chargedCurrency).toBeDefined();
    });

    it("should serialize complete transaction data in raw field", () => {
      const result = tableRow(mockTransactionRow);

      expect(result.raw).toBeDefined();
      const parsed = JSON.parse(result.raw!);
      expect(parsed).toEqual(mockTransactionRow);
    });

    it("should handle transactions with undefined/null values in raw field", () => {
      const transactionWithNulls: TransactionRow = {
        ...mockTransactionRow,
        memo: undefined as any,
        category: null as any,
      };

      const result = tableRow(transactionWithNulls);

      expect(result.raw).toBeDefined();
      const parsed = JSON.parse(result.raw!);
      expect(parsed.memo).toBeUndefined();
      expect(parsed.category).toBeNull();
    });
  });
});
