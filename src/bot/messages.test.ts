import { CompanyTypes } from "israeli-bank-scrapers";
import { getSummaryMessages, saving } from "./messages.js";
import { AccountScrapeResult, Transaction, TransactionRow } from "../types.js";
import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";
import {
  createSaveStats,
  SaveStats,
  statsString,
  getSkippedCount,
  skippedString,
} from "./saveStats.js";
import { Timer } from "../utils/Timer.js";
import { transaction } from "../utils/tests.js";

describe("messages", () => {
  describe("getSummaryMessages", () => {
    it("should return a summary message", () => {
      const txns1 = [
        transaction({
          chargedAmount: -20,
          originalAmount: -100,
          description: "ILS",
          chargedCurrency: "ILS",
          originalCurrency: "USD",
        }),
      ];

      const txns2 = [
        transaction({
          type: TransactionTypes.Installments,
        }),
        transaction({
          status: TransactionStatuses.Pending,
          originalAmount: 20,
        }),
        transaction({
          status: TransactionStatuses.Pending,
          originalAmount: 20,
          originalCurrency: "USD",
        }),
        transaction({
          status: TransactionStatuses.Pending,
          originalAmount: -20,
        }),
        transaction({
          description: "description2",
          memo: "memo2",
        }),
        transaction({
          chargedAmount: 20,
          originalAmount: 5,
          originalCurrency: "USD",
        }),
        transaction({
          chargedAmount: 1000,
          originalAmount: 1000,
          originalCurrency: "USD",
          chargedCurrency: "USD",
        }),
      ];
      const results: Array<AccountScrapeResult> = [
        {
          companyId: CompanyTypes.max,
          result: {
            success: true,
            accounts: [
              {
                accountNumber: "account1",
                txns: txns1,
              },
              {
                accountNumber: "account2",
                txns: txns2,
              },
            ],
          },
        },
      ];

      const stats: Array<SaveStats> = [
        createSaveStats("Storage 1", "TheTable", txns1 as any, {
          added: txns1.length,
        }),
        createSaveStats("Storage 2", "TheTable", txns2 as any, {
          added: txns2.length,
          highlightedTransactions: {
            Group1: [
              {
                account: "account1",
                companyId: CompanyTypes.max,
                hash: "hash1",
                type: TransactionTypes.Normal,
                date: new Date("2026-01-30").toISOString(),
                processedDate: new Date("2026-01-30").toISOString(),
                description: "description1",
                originalAmount: 10,
                uniqueId: "uniqueId1",
                originalCurrency: "ILS",
                chargedAmount: 10,
                status: TransactionStatuses.Completed,
              },
            ],
          },
        }),
      ];

      const summary = getSummaryMessages(results);
      expect(summary).toMatchSnapshot();

      const saveSummaries = stats.map((stats) => statsString(stats, 350000));
      expect(saveSummaries).toMatchSnapshot();
    });

    it("should return a summary message with no results", () => {
      const results: Array<AccountScrapeResult> = [];

      const stats: Array<SaveStats> = [];

      const summary = getSummaryMessages(results);
      expect(summary).toMatchSnapshot();

      const saveSummaries = stats.map((stats) => statsString(stats, 0));
      expect(saveSummaries).toMatchSnapshot();
    });

    it("should return a summary message with failed results", () => {
      const results: Array<AccountScrapeResult> = [
        {
          companyId: CompanyTypes.max,
          result: {
            success: false,
            errorType: ScraperErrorTypes.Generic,
            errorMessage: "Some error message",
          },
        },
        {
          companyId: CompanyTypes.hapoalim,
          result: {
            success: false,
            errorType: ScraperErrorTypes.ChangePassword,
          },
        },
        {
          companyId: CompanyTypes.hapoalim,
          result: {
            success: true,
            accounts: [
              {
                accountNumber: "account1",
                txns: [transaction({})],
              },
            ],
          },
        },
      ];

      const stats: Array<SaveStats> = [];

      const summary = getSummaryMessages(results);
      expect(summary).toMatchSnapshot();

      const saveSummaries = stats.map((stats) => statsString(stats, 0));
      expect(saveSummaries).toMatchSnapshot();
    });

    it("should return a summary message with installments", () => {
      const transactions = [
        transaction({
          type: TransactionTypes.Installments,
          chargedAmount: 20,
          originalAmount: 100,
          description: "should be +20",
        }),
        transaction({
          type: TransactionTypes.Installments,
          chargedAmount: -20,
          originalAmount: -100,
          description: "should be -20",
        }),
      ];

      const results: Array<AccountScrapeResult> = [
        {
          companyId: CompanyTypes.max,
          result: {
            success: true,
            accounts: [
              {
                accountNumber: "account1",
                txns: transactions,
              },
            ],
          },
        },
      ];

      const stats: Array<SaveStats> = [
        createSaveStats("Storage 1", "TheTable", transactions as any, {
          added: 2,
          highlightedTransactions: {
            SomeGroup: transactions.map<TransactionRow>((t) => ({
              account: "account1",
              companyId: CompanyTypes.max,
              hash: "hash1",
              uniqueId: "uniqueId1",
              ...t,
            })),
          },
        }),
      ];

      const summary = getSummaryMessages(results);
      expect(summary).toMatchSnapshot();

      const saveSummaries = stats.map((stats) => statsString(stats, 0));
      expect(saveSummaries).toMatchSnapshot();
    });

    it("should not add empty groups", () => {
      const tx = {
        ...transaction({}),
        hash: "hash1",
        uniqueId: "uniqueId1",
        account: "account1",
        companyId: CompanyTypes.max,
      };
      const stats: Array<SaveStats> = [
        createSaveStats("Storage", "TheTable", [tx], {
          highlightedTransactions: {
            Group1: [],
            Group2: [
              {
                ...transaction({}),
                hash: "hash1",
                uniqueId: "uniqueId1",
                account: "account1",
                companyId: CompanyTypes.max,
              },
            ],
          },
        }),
      ];

      const saveSummaries = stats.map((stats) => statsString(stats, 0));
      expect(saveSummaries).toMatchSnapshot();
    });

    it("should detect duplicate uniqueId in batch", () => {
      const baseDate = "2025-01-15T10:00:00.000Z";
      const transactions = [
        // These two will have the same uniqueId
        transaction({
          date: baseDate,
          chargedAmount: -20,
          description: "Duplicate transaction 1",
          memo: "memo1",
        }),
        transaction({
          date: baseDate,
          chargedAmount: -20,
          description: "Duplicate transaction 1",
          memo: "memo1",
        }),
        // Unique transaction
        transaction({
          date: baseDate,
          chargedAmount: -40,
          description: "Unique transaction",
        }),
        // These three will have the same uniqueId
        transaction({
          date: baseDate,
          chargedAmount: -50,
          description: "Another duplicate",
          memo: "memo2",
        }),
        transaction({
          date: baseDate,
          chargedAmount: -50,
          description: "Another duplicate",
          memo: "memo2",
        }),
        transaction({
          date: baseDate,
          chargedAmount: -50,
          description: "Another duplicate",
          memo: "memo2",
        }),
      ];

      const results: Array<AccountScrapeResult> = [
        {
          companyId: CompanyTypes.mizrahi,
          result: {
            success: true,
            accounts: [
              {
                accountNumber: "account1",
                txns: transactions,
              },
            ],
          },
        },
      ];

      const summary = getSummaryMessages(results);
      expect(summary).toMatchSnapshot();
      expect(summary).toContain("Duplicate uniqueId detected");
      // Check that the actual uniqueIds are shown (not descriptions)
      expect(summary).toMatch(/2025-01-15_mizrahi_account1_-20/);
      expect(summary).toMatch(/2025-01-15_mizrahi_account1_-50/);
    });

    it("should not add empty groups", () => {
      const stats: Array<SaveStats> = [
        createSaveStats("Storage", "TheTable", [], {
          highlightedTransactions: {
            Group1: [],
          },
        }),
      ];

      const saveSummaries = stats.map((stats) => statsString(stats, 0));
      expect(saveSummaries).toMatchSnapshot();
    });

    it("should support steps", () => {
      const tx = {
        ...transaction({}),
        hash: "hash1",
        uniqueId: "uniqueId1",
        account: "account1",
        companyId: CompanyTypes.max,
      };
      const stats: Array<SaveStats> = [
        createSaveStats("Storage", "TheTable", [tx], {
          added: 1,
          highlightedTransactions: {
            Group1: [tx],
          },
        }),
      ];
      const steps: Array<Timer> = [
        Object.assign(new Timer("Step1"), { duration: 10 }),
        Object.assign(new Timer("Step2"), { duration: 100 }),
        Object.assign(new Timer("Step3"), { duration: 10_000 }),
        Object.assign(new Timer("Step4"), { duration: 100_456 }),
      ];
      const saveSummaries = stats.map((stats) => statsString(stats, 0, steps));
      expect(saveSummaries).toMatchSnapshot();
    });

    it("should support stats with skipped transactions", () => {
      const tx = {
        ...transaction({}),
        hash: "hash1",
        uniqueId: "uniqueId1",
        account: "account1",
        companyId: CompanyTypes.max,
      };
      const stats: Array<SaveStats> = [
        createSaveStats("Storage", "TheTable", [tx], {
          added: 1,
          existing: 1,
          pending: 1,
          highlightedTransactions: {
            Group1: [tx],
          },
        }),
      ];
      const saveSummaries = stats.map((stats) => statsString(stats, 0));
      expect(saveSummaries).toMatchSnapshot();
    });

    it("should use expandable block quotation for successful accounts only (HTML)", () => {
      const results: Array<AccountScrapeResult> = [
        {
          companyId: CompanyTypes.max,
          result: {
            success: true,
            accounts: [
              {
                accountNumber: "account1",
                txns: [transaction({})],
              },
              {
                accountNumber: "account2",
                txns: [transaction({}), transaction({})],
              },
            ],
          },
        },
      ];

      const summary = getSummaryMessages(results);
      expect(summary).toMatchSnapshot();
    });

    it("should use expandable block quotation for mixed success/error accounts (HTML)", () => {
      const results: Array<AccountScrapeResult> = [
        {
          companyId: CompanyTypes.max,
          result: {
            success: false,
            errorType: ScraperErrorTypes.Generic,
            errorMessage: "Connection failed",
          },
        },
        {
          companyId: CompanyTypes.hapoalim,
          result: {
            success: true,
            accounts: [
              {
                accountNumber: "12345",
                txns: [
                  transaction({}),
                  transaction({}),
                  transaction({}),
                  transaction({}),
                  transaction({}),
                ],
              },
              {
                accountNumber: "67890",
                txns: [transaction({}), transaction({}), transaction({})],
              },
            ],
          },
        },
      ];

      const summary = getSummaryMessages(results);
      expect(summary).toMatchSnapshot();
    });

    it("should support stats with otherSkipped transactions", () => {
      const tx = {
        ...transaction({}),
        hash: "hash1",
        uniqueId: "uniqueId1",
        account: "account1",
        companyId: CompanyTypes.max,
      };
      const stats: Array<SaveStats> = [
        createSaveStats("Storage", "TheTable", [tx], {
          added: 1,
          existing: 1,
          pending: 1,
          otherSkipped: 2,
          highlightedTransactions: {
            Group1: [tx],
          },
        }),
      ];
      const saveSummaries = stats.map((stats) => statsString(stats, 0));
      expect(saveSummaries).toMatchSnapshot();
    });
  });

  describe("getSkippedCount", () => {
    it("should calculate skipped count including existing, pending, and otherSkipped", () => {
      const stats = createSaveStats("Test", "TheTable", [], {
        existing: 2,
        pending: 3,
        otherSkipped: 1,
      });

      expect(getSkippedCount(stats)).toBe(6); // 2 + 3 + 1
    });

    it("should handle zero values", () => {
      const stats = createSaveStats("Test", "TheTable", [], {
        existing: 0,
        pending: 0,
        otherSkipped: 0,
      });

      expect(getSkippedCount(stats)).toBe(0);
    });

    it("should handle when only otherSkipped has value", () => {
      const stats = createSaveStats("Test", "TheTable", [], {
        existing: 0,
        pending: 0,
        otherSkipped: 5,
      });

      expect(getSkippedCount(stats)).toBe(5);
    });
  });

  describe("skippedString", () => {
    it("should return empty string when no skipped transactions", () => {
      const stats = createSaveStats("Test", "TheTable", [], {
        existing: 0,
        pending: 0,
        otherSkipped: 0,
      });

      expect(skippedString(stats)).toBe("");
    });

    it("should format only pending transactions", () => {
      const stats = createSaveStats("Test", "TheTable", [], {
        existing: 0,
        pending: 3,
        otherSkipped: 0,
      });

      expect(skippedString(stats)).toBe("3 skipped (3 pending)");
    });

    it("should format only existing transactions", () => {
      const stats = createSaveStats("Test", "TheTable", [], {
        existing: 2,
        pending: 0,
        otherSkipped: 0,
      });

      expect(skippedString(stats)).toBe("2 skipped (2 existing)");
    });

    it("should format only other skipped transactions", () => {
      const stats = createSaveStats("Test", "TheTable", [], {
        existing: 0,
        pending: 0,
        otherSkipped: 1,
      });

      expect(skippedString(stats)).toBe("1 skipped (1 other)");
    });

    it("should format existing and pending transactions", () => {
      const stats = createSaveStats("Test", "TheTable", [], {
        existing: 1,
        pending: 1,
        otherSkipped: 0,
      });

      expect(skippedString(stats)).toBe("2 skipped (1 existing, 1 pending)");
    });

    it("should format all three types of skipped transactions", () => {
      const stats = createSaveStats("Test", "TheTable", [], {
        existing: 1,
        pending: 1,
        otherSkipped: 2,
      });

      expect(skippedString(stats)).toBe(
        "4 skipped (1 existing, 1 pending, 2 other)",
      );
    });

    it("should format with multiple of each type", () => {
      const stats = createSaveStats("Test", "TheTable", [], {
        existing: 5,
        pending: 3,
        otherSkipped: 7,
      });

      expect(skippedString(stats)).toBe(
        "15 skipped (5 existing, 3 pending, 7 other)",
      );
    });
  });

  describe("createSaveStats", () => {
    it("should initialize otherSkipped to 0 by default", () => {
      const stats = createSaveStats("Test", "TheTable", []);

      expect(stats.otherSkipped).toBe(0);
      expect(stats.existing).toBe(0);
      expect(stats.pending).toBe(0);
      expect(getSkippedCount(stats)).toBe(0);
    });

    it("should allow overriding otherSkipped value", () => {
      const stats = createSaveStats("Test", "TheTable", [], {
        otherSkipped: 3,
      });

      expect(stats.otherSkipped).toBe(3);
      expect(getSkippedCount(stats)).toBe(3);
    });
  });

  describe("saving", () => {
    it("should return a saving message", () => {
      const savingMessage = saving("Storage");
      expect(savingMessage).toMatchSnapshot();
    });

    it("should return a saving message with steps", () => {
      const steps: Array<Timer> = [
        Object.assign(new Timer("Step1"), { duration: 10 }),
        Object.assign(new Timer("Step2"), { duration: 100 }),
        Object.assign(new Timer("Step3"), { duration: 10_000 }),
        Object.assign(new Timer("Step4"), { duration: 100_456 }),
      ];
      const savingMessage = saving("Storage", steps);
      expect(savingMessage).toMatchSnapshot();
    });

    it("should return a saving message with not finished steps", () => {
      const savingMessage = saving("Storage", [
        Object.assign(new Timer("Step1"), { duration: 10 }),
        Object.assign(new Timer("Step2"), { duration: 100 }),
        Object.assign(new Timer("Step3"), { duration: 10000 }),
        new Timer("Step4"),
      ]);
      expect(savingMessage).toMatchSnapshot();
    });

    it("should return a saving message with one not finished step", () => {
      const savingMessage = saving("Storage", [new Timer("Step4")]);
      expect(savingMessage).toMatchSnapshot();
    });
  });
});
