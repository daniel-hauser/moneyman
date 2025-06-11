import { GoogleSheetsStorage } from "./sheets.js";
import {
  GoogleSpreadsheet,
  GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { CompanyTypes } from "israeli-bank-scrapers";
import { mock, MockProxy, mockClear } from "jest-mock-extended";
import { transaction } from "../../utils/tests.js";
import type { TransactionRow } from "../../types.js";

// Create mocks at top level
const mockSheet = mock<GoogleSpreadsheetWorksheet>({
  headerValues: ["date", "amount", "description", "hash"],
});
const mockDoc = mock<GoogleSpreadsheet>({
  sheetsByTitle: { _moneyman: mockSheet },
});

// Mock the google-spreadsheet module
jest.mock("google-spreadsheet", () => ({
  GoogleSpreadsheet: jest.fn(() => mockDoc),
}));
jest.mock("google-auth-library");

// Mock logger
jest.mock("../../utils/logger.js", () => ({
  createLogger: () => jest.fn(),
}));

// Mock other dependencies
jest.mock("../notifier.js", () => ({
  sendDeprecationMessage: jest.fn(),
}));

jest.mock("../saveStats.js", () => ({
  createSaveStats: jest.fn().mockReturnValue({
    existing: 0,
    added: 0,
    highlightedTransactions: { Added: [] },
  }),
}));

jest.mock("../transactionTableRow.js", () => ({
  tableRow: jest.fn().mockReturnValue({}),
}));

describe("GoogleSheetsStorage", () => {
  let storage: GoogleSheetsStorage;

  // Helper to create a TransactionRow using existing test utility
  const createMockTransactionRow = (): TransactionRow => ({
    ...transaction({
      status: TransactionStatuses.Completed,
    }),
    account: "test-account",
    companyId: CompanyTypes.hapoalim,
    hash: "test-hash",
    uniqueId: "test-unique-id",
  });

  beforeEach(() => {
    storage = new GoogleSheetsStorage();

    // Setup default mock implementations
    mockSheet.getCellsInRange.mockResolvedValue([[]]);
    mockSheet.addRows.mockResolvedValue([]);
    mockSheet.loadHeaderRow.mockResolvedValue(undefined);
    mockDoc.loadInfo.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockClear(mockDoc);
    mockClear(mockSheet);
  });

  describe("retry logic for Google API operations", () => {
    it("should retry doc.loadInfo on 503 error", async () => {
      // Mock loadInfo to fail twice with 503, then succeed
      let callCount = 0;
      mockDoc.loadInfo.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject(
            new Error(
              "Google API error - [503] The service is currently unavailable",
            ),
          );
        }
        return Promise.resolve(undefined);
      });

      // This should succeed after retries
      const doc = await (storage as any).getDoc();

      expect(mockDoc.loadInfo).toHaveBeenCalledTimes(3);
      expect(doc).toBe(mockDoc);
    });

    it("should retry sheet.addRows on 503 error with deduplication", async () => {
      mockDoc.loadInfo.mockResolvedValue(undefined);
      mockSheet.loadHeaderRow.mockResolvedValue(undefined);

      // Mock addRows to fail once with 503, then succeed on retry
      let addRowsCallCount = 0;
      mockSheet.addRows.mockImplementation(() => {
        addRowsCallCount++;
        if (addRowsCallCount === 1) {
          return Promise.reject(
            new Error(
              "Google API error - [503] The service is currently unavailable",
            ),
          );
        }
        return Promise.resolve([]);
      });

      // Mock getCellsInRange for hash loading (initial and retry)
      let getCellsCallCount = 0;
      mockSheet.getCellsInRange.mockImplementation(() => {
        getCellsCallCount++;
        if (getCellsCallCount === 1) {
          // Initial hash loading - empty sheet
          return Promise.resolve([[]]);
        } else {
          // Retry hash loading - still empty (simulating no rows were actually saved)
          return Promise.resolve([[]]);
        }
      });

      const mockTxn = createMockTransactionRow();

      await storage.saveTransactions([mockTxn], async () => {});

      // Should call addRows twice: initial attempt + retry
      expect(mockSheet.addRows).toHaveBeenCalledTimes(2);
      // Should call getCellsInRange twice: initial hash load + retry hash load
      expect(mockSheet.getCellsInRange).toHaveBeenCalledTimes(2);
    });

    it("should deduplicate rows on retry when some were already saved", async () => {
      mockDoc.loadInfo.mockResolvedValue(undefined);
      mockSheet.loadHeaderRow.mockResolvedValue(undefined);

      // Mock addRows to fail once with 503, then succeed on retry
      let addRowsCallCount = 0;
      mockSheet.addRows.mockImplementation(() => {
        addRowsCallCount++;
        if (addRowsCallCount === 1) {
          return Promise.reject(
            new Error(
              "Google API error - [503] The service is currently unavailable",
            ),
          );
        }
        return Promise.resolve([]);
      });

      // Mock getCellsInRange for hash loading (initial and retry)
      let getCellsCallCount = 0;
      mockSheet.getCellsInRange.mockImplementation(() => {
        getCellsCallCount++;
        if (getCellsCallCount === 1) {
          // Initial hash loading - empty sheet
          return Promise.resolve([[]]);
        } else {
          // Retry hash loading - first transaction was saved during the failed attempt
          return Promise.resolve([["test-hash"]]);
        }
      });

      const mockTxn = createMockTransactionRow();

      await storage.saveTransactions([mockTxn], async () => {});

      // Should call addRows once (initial attempt fails, but on retry no rows needed)
      expect(mockSheet.addRows).toHaveBeenCalledTimes(1);
      // Should call getCellsInRange twice: initial hash load + retry hash load
      expect(mockSheet.getCellsInRange).toHaveBeenCalledTimes(2);
    });

    it("should show retry progress message with correct row count", async () => {
      mockDoc.loadInfo.mockResolvedValue(undefined);
      mockSheet.loadHeaderRow.mockResolvedValue(undefined);

      // Mock addRows to fail once with 503, then succeed on retry
      let addRowsCallCount = 0;
      mockSheet.addRows.mockImplementation(() => {
        addRowsCallCount++;
        if (addRowsCallCount === 1) {
          return Promise.reject(
            new Error(
              "Google API error - [503] The service is currently unavailable",
            ),
          );
        }
        return Promise.resolve([]);
      });

      // Mock getCellsInRange for hash loading - simulate empty sheet throughout
      mockSheet.getCellsInRange.mockResolvedValue([[]]);

      const mockTxn1 = createMockTransactionRow();
      const mockTxn2 = {
        ...createMockTransactionRow(),
        hash: "test-hash-2",
        uniqueId: "test-unique-id-2",
      };

      const onProgressSpy = jest.fn();
      await storage.saveTransactions([mockTxn1, mockTxn2], onProgressSpy);

      // Should show initial save and retry messages
      expect(onProgressSpy).toHaveBeenCalledWith("Saving 2 rows");
      expect(onProgressSpy).toHaveBeenCalledWith("retry: Saving 2 rows");
    });

    it("should retry sheet.loadHeaderRow on 503 error", async () => {
      mockDoc.loadInfo.mockResolvedValue(undefined);

      // Mock loadHeaderRow to fail twice with 503, then succeed
      let callCount = 0;
      mockSheet.loadHeaderRow.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject(
            new Error(
              "Google API error - [503] The service is currently unavailable",
            ),
          );
        }
        return Promise.resolve(undefined);
      });

      const mockTxn = createMockTransactionRow();

      await storage.saveTransactions([mockTxn], async () => {});

      expect(mockSheet.loadHeaderRow).toHaveBeenCalledTimes(3);
    });

    it("should retry sheet.getCellsInRange on 503 error", async () => {
      mockDoc.loadInfo.mockResolvedValue(undefined);
      mockSheet.loadHeaderRow.mockResolvedValue(undefined);

      // Mock getCellsInRange to fail twice with 503, then succeed
      let callCount = 0;
      mockSheet.getCellsInRange.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.reject(
            new Error(
              "Google API error - [503] The service is currently unavailable",
            ),
          );
        }
        return Promise.resolve([[]]);
      });

      const mockTxn = createMockTransactionRow();

      await storage.saveTransactions([mockTxn], async () => {});

      expect(mockSheet.getCellsInRange).toHaveBeenCalledTimes(3);
    });

    it("should not retry on non-503 errors", async () => {
      mockDoc.loadInfo.mockRejectedValue(new Error("Some other error"));

      await expect((storage as any).getDoc()).rejects.toThrow(
        "Some other error",
      );

      expect(mockDoc.loadInfo).toHaveBeenCalledTimes(1);
    });

    it("should throw after max retries exceeded", async () => {
      mockDoc.loadInfo.mockRejectedValue(
        new Error(
          "Google API error - [503] The service is currently unavailable",
        ),
      );

      await expect((storage as any).getDoc()).rejects.toThrow(
        "Google API error - [503] The service is currently unavailable",
      );

      expect(mockDoc.loadInfo).toHaveBeenCalledTimes(3); // Initial call + 2 retries
    });

    it("should handle different 503 error message formats", async () => {
      const errorMessages = [
        "503 Service Unavailable",
        "currently unavailable",
        "temporarily unavailable",
        "Service Unavailable",
      ];

      for (const errorMessage of errorMessages) {
        let callCount = 0;
        mockDoc.loadInfo.mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error(errorMessage));
          }
          return Promise.resolve(undefined);
        });

        await (storage as any).getDoc();

        expect(mockDoc.loadInfo).toHaveBeenCalledTimes(2);
        mockDoc.loadInfo.mockClear();
      }
    });
  });

  describe("canSave", () => {
    it("should return false when GOOGLE_SHEET_ID is missing", () => {
      const originalValue = process.env.GOOGLE_SHEET_ID;
      delete process.env.GOOGLE_SHEET_ID;

      const newStorage = new (require("./sheets.js").GoogleSheetsStorage)();
      expect(newStorage.canSave()).toBe(false);

      process.env.GOOGLE_SHEET_ID = originalValue;
    });
  });
});
