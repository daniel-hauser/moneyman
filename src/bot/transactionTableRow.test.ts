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
      // Mock the config with moneyman hash type
      const originalConfig = jest.requireMock("../config.js").config;
      originalConfig.options.scraping.transactionHashType = "moneyman";

      const mockTransaction = createMockTransactionRow({
        hash: "test-hash",
        uniqueId: "test-unique-id",
      });

      const result = tableRow(mockTransaction);

      expect(result.hash).toBe("test-unique-id");

      // Reset to original value
      originalConfig.options.scraping.transactionHashType = "";
    });

    it("should include raw field when includeRaw is true", () => {
      const mockTransaction = createMockTransactionRow({
        chargedAmount: 100,
        description: "Test transaction",
        memo: "Test memo",
      });

      const result = tableRow(mockTransaction, true);

      expect(result.raw).toBeDefined();
      expect(result.raw).toBe(JSON.stringify(mockTransaction));
    });

    it("should not include raw field when includeRaw is false", () => {
      const mockTransaction = createMockTransactionRow({
        chargedAmount: 100,
        description: "Test transaction",
        memo: "Test memo",
      });

      const result = tableRow(mockTransaction, false);

      expect(result.raw).toBeUndefined();
    });

    it("should not include raw field by default (when includeRaw is not specified)", () => {
      const mockTransaction = createMockTransactionRow({
        chargedAmount: 100,
        description: "Test transaction",
        memo: "Test memo",
      });

      const result = tableRow(mockTransaction);

      expect(result.raw).toBeUndefined();
    });

    it("should include all other required fields", () => {
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

    it("should serialize complete transaction data in raw field when includeRaw is true", () => {
      const mockTransaction = createMockTransactionRow({
        chargedAmount: 100,
        description: "Test transaction",
        memo: "Test memo",
      });

      const result = tableRow(mockTransaction, true);

      expect(result.raw).toBeDefined();
      const parsed = JSON.parse(result.raw!);
      expect(parsed).toEqual(mockTransaction);
    });

    it("should handle transactions with undefined/null values in raw field when includeRaw is true", () => {
      const mockTransaction = createMockTransactionRow({
        chargedAmount: 100,
        description: "Test transaction",
        memo: undefined as any,
        category: null as any,
      });

      const result = tableRow(mockTransaction, true);

      expect(result.raw).toBeDefined();
      const parsed = JSON.parse(result.raw!);
      expect(parsed.memo).toBeUndefined();
      expect(parsed.category).toBeNull();
    });
  });
});
