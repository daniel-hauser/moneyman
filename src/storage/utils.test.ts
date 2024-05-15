import {
  Transaction,
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions";
import { transactionUniqueId, transactionHash } from "./utils";
import { CompanyTypes } from "israeli-bank-scrapers";

const transaction1: Transaction = {
  date: "2021-01-01",
  processedDate: "2021-01-01",
  chargedAmount: 1000,
  description: "desc 1",
  memo: "memo 1",
  originalAmount: 1000,
  originalCurrency: "ILS",
  identifier: "identifier1",
  status: TransactionStatuses.Completed,
  type: TransactionTypes.Normal,
};

const transaction2: Transaction = {
  date: "2021-01-01",
  processedDate: "2021-01-01",
  chargedAmount: 999,
  description: "desc 2",
  memo: "memo 2",
  originalAmount: 999,
  originalCurrency: "ILS",
  identifier: "identifier2",
  status: TransactionStatuses.Completed,
  type: TransactionTypes.Normal,
};

describe("transactionHash", () => {
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

describe("transactionUniqueId", () => {
  it("should return the same unique id for the same transaction", () => {
    const companyId = CompanyTypes.hapoalim;
    const accountNumber = "123";
    const id1 = transactionUniqueId(transaction1, companyId, accountNumber);
    const id2 = transactionUniqueId(transaction1, companyId, accountNumber);

    expect(id1).toBe(id2);
    expect(id1).toMatchSnapshot();
  });

  it("should return different unique ids for different transactions", () => {
    const companyId = CompanyTypes.hapoalim;
    const accountNumber = "123";
    const id1 = transactionUniqueId(transaction1, companyId, accountNumber);
    const id2 = transactionUniqueId(transaction2, companyId, accountNumber);

    expect(id1).not.toBe(id2);
  });

  it("should return different unique ids for different company ids", () => {
    const accountNumber = "123";
    const id1 = transactionUniqueId(
      transaction1,
      CompanyTypes.leumi,
      accountNumber,
    );

    const id2 = transactionUniqueId(
      transaction1,
      CompanyTypes.isracard,
      accountNumber,
    );

    expect(id1).not.toBe(id2);
  });

  it("should return different unique ids for different account numbers", () => {
    const companyId = CompanyTypes.hapoalim;
    const id1 = transactionUniqueId(transaction1, companyId, "123");
    const id2 = transactionUniqueId(transaction1, companyId, "456");

    expect(id1).not.toBe(id2);
  });

  it("should convert nullish values to empty strings", () => {
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

  it('should return different unique ids for transactions with different "identifier" values', () => {
    const companyId = CompanyTypes.hapoalim;
    const accountNumber = "123";
    const tx1 = { ...transaction1, identifier: "1" };
    const tx2 = { ...transaction1, identifier: "2" };

    // The old hash will be the same for both transactions because it doesn't include the identifier
    expect(transactionHash(tx1, companyId, accountNumber)).toBe(
      transactionHash(tx2, companyId, accountNumber),
    );

    // The unique id will be different because it includes the identifier
    expect(transactionUniqueId(tx1, companyId, accountNumber)).not.toBe(
      transactionUniqueId(tx2, companyId, accountNumber),
    );
  });

  it.each([undefined, null, ""])(
    'should fallback to "description" + "memo" if "identifier" is %o',
    (identifier) => {
      const tx = {
        ...transaction1,
        identifier,
      };
      const id = transactionUniqueId(tx as any, CompanyTypes.hapoalim, "123");
      expect(id).toContain(`${tx.description}_${tx.memo}`);
    },
  );
});
