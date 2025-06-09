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

// Mock the google-spreadsheet module
jest.mock("google-spreadsheet");
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
  let mockDoc: any;
  let mockSheet: any;

  // Helper to create a valid transaction row
  const createMockTransaction = () => ({
    account: "test-account",
    companyId: CompanyTypes.hapoalim,
    type: TransactionTypes.Normal,
    date: "2023-01-01",
    processedDate: "2023-01-01",
    originalAmount: -100,
    originalCurrency: "ILS",
    chargedAmount: -100,
    chargedCurrency: "ILS",
    description: "Test transaction",
    memo: "Test memo",
    category: "Test category",
    status: TransactionStatuses.Completed,
    uniqueId: "test-unique-id",
    hash: "test-hash",
    identifier: "test-identifier",
  });

  beforeEach(() => {
    storage = new GoogleSheetsStorage();

    // Create mocks with proper structure
    mockDoc = {
      loadInfo: jest.fn(),
      sheetsByTitle: {},
    };

    mockSheet = {
      loadHeaderRow: jest.fn(),
      headerValues: ["date", "amount", "description", "hash"],
      getCellsInRange: jest.fn(),
      addRows: jest.fn(),
    };

    mockDoc.sheetsByTitle._moneyman = mockSheet;

    // Setup default mock implementations
    mockSheet.getCellsInRange.mockResolvedValue([[]]);
    mockSheet.addRows.mockResolvedValue([]);
    mockSheet.loadHeaderRow.mockResolvedValue(undefined);
    mockDoc.loadInfo.mockResolvedValue(undefined);

    (GoogleSpreadsheet as unknown as jest.Mock).mockImplementation(
      () => mockDoc,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("retry logic for Google API operations", () => {
    it("should retry doc.loadInfo on 503 error", async () => {
      // Mock loadInfo to fail twice with 503, then succeed
      mockDoc.loadInfo
        .mockRejectedValueOnce(
          new Error(
            "Google API error - [503] The service is currently unavailable",
          ),
        )
        .mockRejectedValueOnce(
          new Error(
            "Google API error - [503] The service is currently unavailable",
          ),
        )
        .mockResolvedValueOnce(undefined);

      // This should succeed after retries
      const doc = await (storage as any).getDoc();

      expect(mockDoc.loadInfo).toHaveBeenCalledTimes(3);
      expect(doc).toBe(mockDoc);
    });

    it("should retry sheet.addRows on 503 error", async () => {
      mockDoc.loadInfo.mockResolvedValue(undefined);
      mockSheet.loadHeaderRow.mockResolvedValue(undefined);

      // Mock addRows to fail twice with 503, then succeed
      mockSheet.addRows
        .mockRejectedValueOnce(
          new Error(
            "Google API error - [503] The service is currently unavailable",
          ),
        )
        .mockRejectedValueOnce(
          new Error(
            "Google API error - [503] The service is currently unavailable",
          ),
        )
        .mockResolvedValueOnce([]);

      const mockTxn = createMockTransaction();

      await storage.saveTransactions([mockTxn], async () => {});

      expect(mockSheet.addRows).toHaveBeenCalledTimes(3);
    });

    it("should retry sheet.loadHeaderRow on 503 error", async () => {
      mockDoc.loadInfo.mockResolvedValue(undefined);

      // Mock loadHeaderRow to fail twice with 503, then succeed
      mockSheet.loadHeaderRow
        .mockRejectedValueOnce(
          new Error(
            "Google API error - [503] The service is currently unavailable",
          ),
        )
        .mockRejectedValueOnce(
          new Error(
            "Google API error - [503] The service is currently unavailable",
          ),
        )
        .mockResolvedValueOnce(undefined);

      const mockTxn = createMockTransaction();

      await storage.saveTransactions([mockTxn], async () => {});

      expect(mockSheet.loadHeaderRow).toHaveBeenCalledTimes(3);
    });

    it("should retry sheet.getCellsInRange on 503 error", async () => {
      mockDoc.loadInfo.mockResolvedValue(undefined);
      mockSheet.loadHeaderRow.mockResolvedValue(undefined);

      // Mock getCellsInRange to fail twice with 503, then succeed
      mockSheet.getCellsInRange
        .mockRejectedValueOnce(
          new Error(
            "Google API error - [503] The service is currently unavailable",
          ),
        )
        .mockRejectedValueOnce(
          new Error(
            "Google API error - [503] The service is currently unavailable",
          ),
        )
        .mockResolvedValueOnce([[]]);

      const mockTxn = createMockTransaction();

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
        mockDoc.loadInfo
          .mockRejectedValueOnce(new Error(errorMessage))
          .mockResolvedValueOnce(undefined);

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
