import { CompanyTypes } from "israeli-bank-scrapers";
import { getSummaryMessages } from "./messages.js";
import { AccountScrapeResult, Transaction, TransactionRow } from "./types.js";
import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";
import { createSaveStats, SaveStats, statsString } from "./saveStats.js";

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
  });
});

export function transaction(t: Partial<Transaction>): Transaction {
  return {
    type: TransactionTypes.Normal,
    date: new Date().toISOString(),
    processedDate: new Date().toISOString(),
    description: "description1",
    originalAmount: 10,
    originalCurrency: "ILS",
    chargedCurrency: "ILS",
    chargedAmount: t.status === TransactionStatuses.Pending ? 0 : 10,
    status: TransactionStatuses.Completed,
    ...t,
  };
}
