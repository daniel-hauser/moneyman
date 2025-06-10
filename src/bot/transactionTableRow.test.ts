import { tableRow, TableHeaders } from "./transactionTableRow.js";
import { TransactionRow } from "../types.js";
import { CompanyTypes } from "israeli-bank-scrapers";
import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { transaction } from "../utils/tests.js";

// Mock the config module to avoid ACCOUNTS_JSON requirement
jest.mock("../config.js", () => ({
  systemName: "test-system",
}));

// Helper to create a TransactionRow using existing test utility
const createMockTransactionRow = (
  overrides: Partial<TransactionRow> = {},
): TransactionRow => ({
  ...transaction({
    status: TransactionStatuses.Completed,
  }),
  account: "test-account",
  companyId: CompanyTypes.hapoalim,
  hash: "test-hash",
  uniqueId: "test-unique-id",
  ...overrides,
});

describe("transactionTableRow", () => {
  describe("TableHeaders", () => {
    it("should include raw column", () => {
      expect(TableHeaders).toContain("raw");
    });

    it("should have raw column as one of the headers", () => {
      expect(TableHeaders.indexOf("raw")).toBeGreaterThan(-1);
    });
  });

  describe("tableRow", () => {
    beforeEach(() => {
      // Clean up environment variables to avoid interference
      delete process.env.RAW_TRANSACTION_DATA_DISABLED;
    });

    afterEach(() => {
      // Clean up environment variables
      delete process.env.RAW_TRANSACTION_DATA_DISABLED;
    });

    it("should include raw field when RAW_TRANSACTION_DATA_DISABLED is false (default)", () => {
      const mockTransaction = createMockTransactionRow({
        chargedAmount: 100,
        description: "Test transaction",
        memo: "Test memo",
      });

      const result = tableRow(mockTransaction);

      expect(result.raw).toBeDefined();
      expect(result.raw).toBe(JSON.stringify(mockTransaction));
    });

    it("should include raw field when RAW_TRANSACTION_DATA_DISABLED is explicitly set to false", () => {
      process.env.RAW_TRANSACTION_DATA_DISABLED = "false";

      const mockTransaction = createMockTransactionRow({
        chargedAmount: 100,
        description: "Test transaction",
        memo: "Test memo",
      });

      const result = tableRow(mockTransaction);

      expect(result.raw).toBeDefined();
      expect(result.raw).toBe(JSON.stringify(mockTransaction));
    });

    it("should not include raw field when RAW_TRANSACTION_DATA_DISABLED is true", () => {
      process.env.RAW_TRANSACTION_DATA_DISABLED = "true";

      const mockTransaction = createMockTransactionRow({
        chargedAmount: 100,
        description: "Test transaction",
        memo: "Test memo",
      });

      const result = tableRow(mockTransaction);

      expect(result.raw).toBeUndefined();
    });

    it("should include all other required fields regardless of raw setting", () => {
      process.env.RAW_TRANSACTION_DATA_DISABLED = "true";

      const mockTransaction = createMockTransactionRow({
        chargedAmount: 100,
        description: "Test transaction",
        memo: "Test memo",
        identifier: "test-id",
      });

      const result = tableRow(mockTransaction);

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
      const mockTransaction = createMockTransactionRow({
        chargedAmount: 100,
        description: "Test transaction",
        memo: "Test memo",
      });

      const result = tableRow(mockTransaction);

      expect(result.raw).toBeDefined();
      const parsed = JSON.parse(result.raw!);
      expect(parsed).toEqual(mockTransaction);
    });

    it("should handle transactions with undefined/null values in raw field", () => {
      const mockTransaction = createMockTransactionRow({
        chargedAmount: 100,
        description: "Test transaction",
        memo: undefined as any,
        category: null as any,
      });

      const result = tableRow(mockTransaction);

      expect(result.raw).toBeDefined();
      const parsed = JSON.parse(result.raw!);
      expect(parsed.memo).toBeUndefined();
      expect(parsed.category).toBeNull();
    });
  });
});
