import { GoogleSheetsStorage } from "./sheets.js";
import {
  GoogleSpreadsheet,
  GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { CompanyTypes } from "israeli-bank-scrapers";
import { mock, mockClear } from "jest-mock-extended";
import { transaction } from "../../utils/tests.js";
import type { TransactionRow } from "../../types.js";
import type { MoneymanConfig } from "../../config.js";

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
  sendError: jest.fn(),
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
    const mockConfig: MoneymanConfig = {
      accounts: [],
      storage: {
        googleSheets: {
          serviceAccountPrivateKey: "test-key",
          serviceAccountEmail: "test@example.com",
          sheetId: "test-sheet-id",
          worksheetName: "_moneyman",
        },
      },
      options: {
        scraping: {
          daysBack: 10,
          futureMonths: 1,
          transactionHashType: "",
          additionalTransactionInfo: false,
          hiddenDeprecations: [],
          maxParallelScrapers: 1,
          domainTracking: false,
        },
        security: {
          blockByDefault: false,
        },
        notifications: {},
        logging: {
          getIpInfoUrl: "https://ipinfo.io/json",
        },
      },
    };

    storage = new GoogleSheetsStorage(mockConfig);

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

  describe("error handling for Google API operations", () => {
    it("should throw error when doc.loadInfo fails", async () => {
      const errorMessage =
        "Google API error - [503] The service is currently unavailable";
      mockDoc.loadInfo.mockRejectedValue(new Error(errorMessage));

      await expect((storage as any).getDoc()).rejects.toThrow(errorMessage);
      expect(mockDoc.loadInfo).toHaveBeenCalledTimes(1);
    });

    it("should throw error when sheet.addRows fails", async () => {
      mockDoc.loadInfo.mockResolvedValue(undefined);
      mockSheet.loadHeaderRow.mockResolvedValue(undefined);

      const errorMessage =
        "Google API error - [503] The service is currently unavailable";
      mockSheet.addRows.mockRejectedValue(new Error(errorMessage));

      const mockTxn = createMockTransactionRow();

      // The function should not throw but handle error internally
      const result = await storage.saveTransactions([mockTxn], async () => {});

      expect(mockSheet.addRows).toHaveBeenCalledTimes(1);
      // Check that getCellsInRange was called again to reload hashes after error
      expect(mockSheet.getCellsInRange).toHaveBeenCalledTimes(2);
      expect(result.otherSkipped).toBe(1);
      expect(result.added).toBe(0);
    });

    it("should throw error when sheet.loadHeaderRow fails", async () => {
      mockDoc.loadInfo.mockResolvedValue(undefined);

      const errorMessage =
        "Google API error - [503] The service is currently unavailable";
      mockSheet.loadHeaderRow.mockRejectedValue(new Error(errorMessage));

      const mockTxn = createMockTransactionRow();

      await expect(
        storage.saveTransactions([mockTxn], async () => {}),
      ).rejects.toThrow(errorMessage);

      expect(mockSheet.loadHeaderRow).toHaveBeenCalledTimes(1);
    });

    it("should throw error when sheet.getCellsInRange fails", async () => {
      mockDoc.loadInfo.mockResolvedValue(undefined);
      mockSheet.loadHeaderRow.mockResolvedValue(undefined);

      const errorMessage =
        "Google API error - [503] The service is currently unavailable";
      mockSheet.getCellsInRange.mockRejectedValue(new Error(errorMessage));

      const mockTxn = createMockTransactionRow();

      await expect(
        storage.saveTransactions([mockTxn], async () => {}),
      ).rejects.toThrow(errorMessage);

      expect(mockSheet.getCellsInRange).toHaveBeenCalledTimes(1);
    });

    it("should handle any error type without retrying", async () => {
      const errorTypes = [
        "Network error",
        "Authentication failed",
        "Invalid request",
        "503 Service Unavailable",
      ];

      for (const errorMessage of errorTypes) {
        mockDoc.loadInfo.mockRejectedValue(new Error(errorMessage));

        await expect((storage as any).getDoc()).rejects.toThrow(errorMessage);
        expect(mockDoc.loadInfo).toHaveBeenCalledTimes(1);

        mockDoc.loadInfo.mockClear();
      }
    });
  });

  describe("canSave", () => {
    it("should return false when GOOGLE_SHEET_ID is missing", () => {
      const configWithoutGoogleSheets: MoneymanConfig = {
        accounts: [],
        storage: {},
        options: {
          scraping: {
            daysBack: 10,
            futureMonths: 1,
            transactionHashType: "",
            additionalTransactionInfo: false,
            hiddenDeprecations: [],
            maxParallelScrapers: 1,
            domainTracking: false,
          },
          security: {
            blockByDefault: false,
          },
          notifications: {},
          logging: {
            getIpInfoUrl: "https://ipinfo.io/json",
          },
        },
      };

      const newStorage = new GoogleSheetsStorage(configWithoutGoogleSheets);
      expect(newStorage.canSave()).toBe(false);
    });
  });
});
