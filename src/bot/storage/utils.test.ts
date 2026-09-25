import {
  Transaction,
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import {
  transactionUniqueId,
  transactionHash,
  disambiguateDuplicateIds,
} from "./utils.js";
import { CompanyTypes } from "israeli-bank-scrapers";
import { transactionRow } from "../../utils/tests.js";

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

  describe("error handling for malformed transactions", () => {
    it("should throw error when transaction has null date", () => {
      const transactionWithNullDate = {
        ...transaction1,
        date: null,
      };

      expect(() => {
        transactionHash(
          transactionWithNullDate as any,
          CompanyTypes.hapoalim,
          "123",
        );
      }).toThrow();
    });

    it("should throw error when transaction has undefined date", () => {
      const transactionWithUndefinedDate = {
        ...transaction1,
        date: undefined,
      };

      expect(() => {
        transactionHash(
          transactionWithUndefinedDate as any,
          CompanyTypes.hapoalim,
          "123",
        );
      }).toThrow();
    });

    it("should throw error when transaction has invalid date string", () => {
      const transactionWithInvalidDate = {
        ...transaction1,
        date: "invalid-date",
      };

      expect(() => {
        transactionHash(
          transactionWithInvalidDate as any,
          CompanyTypes.hapoalim,
          "123",
        );
      }).toThrow();
    });
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

  it("Issue #827: pending transactions with different originalAmounts should get different unique ids", () => {
    const companyId = CompanyTypes.hapoalim;
    const accountNumber = "123";

    const pendingTx1: Transaction = {
      ...transaction1,
      chargedAmount: 0,
      originalAmount: 50,
      identifier: undefined,
      status: TransactionStatuses.Pending,
    };

    const pendingTx2: Transaction = {
      ...transaction1,
      chargedAmount: 0,
      originalAmount: 30,
      identifier: undefined,
      status: TransactionStatuses.Pending,
    };

    const id1 = transactionUniqueId(pendingTx1, companyId, accountNumber);
    const id2 = transactionUniqueId(pendingTx2, companyId, accountNumber);

    expect(id1).not.toBe(id2);
  });

  it("Issue #827: uses originalAmount when chargedAmount is 0", () => {
    const companyId = CompanyTypes.hapoalim;
    const accountNumber = "123";

    const pendingTx: Transaction = {
      ...transaction1,
      chargedAmount: 0,
      originalAmount: 75,
      identifier: undefined,
      status: TransactionStatuses.Pending,
    };

    const id = transactionUniqueId(pendingTx, companyId, accountNumber);
    expect(id).toContain("75");
    expect(id).not.toContain("_0_");
  });
});

describe("disambiguateDuplicateIds", () => {
  it("leaves a batch with no duplicates unchanged", () => {
    const txns = [
      transactionRow({ uniqueId: "a" }),
      transactionRow({ uniqueId: "b" }),
      transactionRow({ uniqueId: "c" }),
    ];
    const result = disambiguateDuplicateIds(txns);
    expect(result.map((t) => t.uniqueId)).toEqual(["a", "b", "c"]);
  });

  it("Issue #827: appends _1, _2 to subsequent collisions (coffee bought twice)", () => {
    const txns = [
      transactionRow({ uniqueId: "coffee" }),
      transactionRow({ uniqueId: "coffee" }),
      transactionRow({ uniqueId: "coffee" }),
    ];
    const result = disambiguateDuplicateIds(txns);
    expect(result.map((t) => t.uniqueId)).toEqual([
      "coffee",
      "coffee_1",
      "coffee_2",
    ]);
  });

  it("first occurrence keeps its original uniqueId (backwards-compatible)", () => {
    const original = transactionRow({ uniqueId: "orig" });
    const [first] = disambiguateDuplicateIds([
      original,
      transactionRow({ uniqueId: "orig" }),
    ]);
    expect(first.uniqueId).toBe("orig");
    expect(first).toBe(original); // same object reference, not a copy
  });

  it("handles interleaved duplicates independently", () => {
    const txns = [
      transactionRow({ uniqueId: "a" }),
      transactionRow({ uniqueId: "b" }),
      transactionRow({ uniqueId: "a" }),
      transactionRow({ uniqueId: "b" }),
      transactionRow({ uniqueId: "a" }),
    ];
    const result = disambiguateDuplicateIds(txns);
    expect(result.map((t) => t.uniqueId)).toEqual([
      "a",
      "b",
      "a_1",
      "b_1",
      "a_2",
    ]);
  });

  it("does not collide when batch already contains a pre-suffixed id", () => {
    // ["a", "a_1", "a"] — "a_1" is a natural id in the batch;
    // the duplicate "a" must skip to "a_2" instead of reusing "a_1".
    const txns = [
      transactionRow({ uniqueId: "a" }),
      transactionRow({ uniqueId: "a_1" }),
      transactionRow({ uniqueId: "a" }),
    ];
    const result = disambiguateDuplicateIds(txns);
    const ids = result.map((t) => t.uniqueId);
    expect(ids).toEqual(["a", "a_1", "a_2"]);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });
});

describe("transactionUniqueId — non-pending zero-amount", () => {
  it("preserves chargedAmount 0 for a completed transaction (does not fall back to originalAmount)", () => {
    const companyId = CompanyTypes.hapoalim;
    const accountNumber = "123";

    const completedZeroTx: Transaction = {
      ...transaction1,
      chargedAmount: 0,
      originalAmount: 75,
      identifier: undefined,
      status: TransactionStatuses.Completed,
    };

    const id = transactionUniqueId(completedZeroTx, companyId, accountNumber);
    expect(id).toContain("_0_");
    expect(id).not.toContain("75");
  });
});
