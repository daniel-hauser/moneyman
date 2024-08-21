import { CompanyTypes } from "israeli-bank-scrapers";
import { getSummaryMessages, saved } from "./messages";
import {
  AccountScrapeResult,
  SaveStats,
  Transaction,
  TransactionRow,
} from "./types";
import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors";

describe("messages", () => {
  describe("getSummaryMessages", () => {
    it("should return a summary message", () => {
      const results: Array<AccountScrapeResult> = [
        {
          companyId: CompanyTypes.max,
          result: {
            success: true,
            accounts: [
              {
                accountNumber: "account1",
                txns: [
                  transaction({
                    chargedAmount: -20,
                    originalAmount: -100,
                    description: "ILS",
                    chargedCurrency: "ILS",
                    originalCurrency: "USD",
                  }),
                ],
              },
              {
                accountNumber: "account2",
                txns: [
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
                ],
              },
            ],
          },
        },
      ];

      const stats: Array<SaveStats> = [
        {
          name: "Storage 1",
          table: "TheTable",
          total: 1,
          added: 2,
          pending: 3,
          skipped: 4,
          existing: 5,
        },
        {
          name: "Storage 2",
          table: "TheTable",
          total: 6,
          added: 7,
          pending: 8,
          skipped: 9,
          existing: 10,
          highlightedTransactions: {
            Group1: [
              {
                account: "account1",
                companyId: CompanyTypes.max,
                hash: "hash1",
                type: TransactionTypes.Normal,
                date: new Date().toISOString(),
                processedDate: new Date().toISOString(),
                description: "description1",
                originalAmount: 10,
                uniqueId: "uniqueId1",
                originalCurrency: "ILS",
                chargedAmount: 10,
                status: TransactionStatuses.Completed,
              },
            ],
          },
        },
      ];

      const summary = getSummaryMessages(results);
      expect(summary).toMatchSnapshot();

      const saveSummaries = stats.map(saved);
      expect(saveSummaries).toMatchSnapshot();
    });

    it("should return a summary message with no results", () => {
      const results: Array<AccountScrapeResult> = [];

      const stats: Array<SaveStats> = [];

      const summary = getSummaryMessages(results);
      expect(summary).toMatchSnapshot();

      const saveSummaries = stats.map(saved);
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

      const saveSummaries = stats.map(saved);
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
        {
          name: "Storage 1",
          table: "TheTable",
          total: 1,
          added: 2,
          pending: 3,
          skipped: 4,
          existing: 5,
          highlightedTransactions: {
            SomeGroup: transactions.map<TransactionRow>((t) => ({
              account: "account1",
              companyId: CompanyTypes.max,
              hash: "hash1",
              uniqueId: "uniqueId1",
              ...t,
            })),
          },
        },
      ];

      const summary = getSummaryMessages(results);
      expect(summary).toMatchSnapshot();

      const saveSummaries = stats.map(saved);
      expect(saveSummaries).toMatchSnapshot();
    });

    it("should not add empty groups", () => {
      const stats: Array<SaveStats> = [
        {
          name: "Storage",
          table: "TheTable",
          total: 1,
          added: 0,
          pending: 0,
          skipped: 0,
          existing: 0,
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
        },
      ];

      const saveSummaries = stats.map(saved);
      expect(saveSummaries).toMatchSnapshot();
    });

    it("should not add empty groups", () => {
      const stats: Array<SaveStats> = [
        {
          name: "Storage",
          table: "TheTable",
          total: 1,
          added: 0,
          pending: 0,
          skipped: 0,
          existing: 0,
          highlightedTransactions: {
            Group1: [],
          },
        },
      ];

      const saveSummaries = stats.map(saved);
      expect(saveSummaries).toMatchSnapshot();
    });
  });
});

function transaction(t: Partial<Transaction>): Transaction {
  return {
    type: TransactionTypes.Normal,
    date: new Date().toISOString(),
    processedDate: new Date().toISOString(),
    description: "description1",
    originalAmount: 10,
    originalCurrency: "ILS",
    chargedAmount: t.status === TransactionStatuses.Pending ? 0 : 10,
    status: TransactionStatuses.Completed,
    ...t,
  };
}
