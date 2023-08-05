import {
  Transaction,
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions";
import { transactionHash } from "./utils";
import { CompanyTypes } from "israeli-bank-scrapers";

describe("transactionHash", () => {
  const transaction1: Transaction = {
    date: "2021-01-01",
    processedDate: "2021-01-01",
    chargedAmount: 1,
    description: "desc 1",
    memo: "memo 1",
    originalAmount: 1,
    originalCurrency: "ILS",
    status: TransactionStatuses.Completed,
    type: TransactionTypes.Normal,
  };

  const transaction2: Transaction = {
    date: "2021-01-01",
    processedDate: "2021-01-01",
    chargedAmount: 1,
    description: "desc 2",
    memo: "memo 2",
    originalAmount: 1,
    originalCurrency: "ILS",
    status: TransactionStatuses.Completed,
    type: TransactionTypes.Normal,
  };

  it("should return the same hash for the same transaction", () => {
    const companyId = CompanyTypes.hapoalim;
    const accountNumber = "123";
    const hash1 = transactionHash(transaction1, companyId, accountNumber);
    const hash2 = transactionHash(transaction1, companyId, accountNumber);

    expect(hash1).toBe(hash2);
  });

  it("should return different hashes for different transactions", () => {
    const companyId = CompanyTypes.hapoalim;
    const accountNumber = "123";
    const hash1 = transactionHash(transaction1, companyId, accountNumber);
    const hash2 = transactionHash(transaction2, companyId, accountNumber);

    expect(hash1).not.toBe(hash2);
  });

  it("should return different hashes for different company ids", () => {
    const accountNumber = "123";
    const hash1 = transactionHash(
      transaction1,
      CompanyTypes.leumi,
      accountNumber,
    );

    const hash2 = transactionHash(
      transaction1,
      CompanyTypes.isracard,
      accountNumber,
    );

    expect(hash1).not.toBe(hash2);
  });

  it("should return different hashes for different account numbers", () => {
    const companyId = CompanyTypes.hapoalim;
    const hash1 = transactionHash(transaction1, companyId, "123");
    const hash2 = transactionHash(transaction1, companyId, "456");

    expect(hash1).not.toBe(hash2);
  });

  it("Issue #132: hash has no nullish string", () => {
    const transactionWithUndefined = {
      ...transaction1,
      chargedAmount: undefined,
      description: undefined,
      memo: undefined,
    };

    const transactionWithNull = {
      ...transaction1,
      chargedAmount: null,
      description: null,
      memo: null,
    };

    for (const transaction of [transactionWithNull, transactionWithUndefined]) {
      const hash = transactionHash(
        transaction as any,
        CompanyTypes.leumi,
        "123",
      );

      expect(hash).not.toContain("null");
      expect(hash).not.toContain("undefined");
    }
  });
});
