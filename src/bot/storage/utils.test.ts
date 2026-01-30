import {
  Transaction,
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { transactionUniqueId, transactionHash } from "./utils.js";
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

  describe("mizrahi bank specific behavior", () => {
    it("should include TransactionNumber when it is not '1'", () => {
      const accountNumber = "123";
      const txWithTxNum2 = {
        ...transaction1,
        rawTransaction: {
          TransactionNumber: "2",
          RowNumber: "10",
        },
      } as any;

      const id = transactionUniqueId(
        txWithTxNum2,
        CompanyTypes.mizrahi,
        accountNumber,
      );

      expect(id).toContain("_2");
    });

    it("should not include TransactionNumber when it is '1'", () => {
      const accountNumber = "123";
      const txWithTxNum1 = {
        ...transaction1,
        rawTransaction: {
          TransactionNumber: "1",
          RowNumber: "10",
        },
      } as any;

      const id = transactionUniqueId(
        txWithTxNum1,
        CompanyTypes.mizrahi,
        accountNumber,
      );

      // Should not end with _1 or _10
      expect(id).not.toMatch(/_1$/);
      expect(id).not.toMatch(/_10$/);
    });

    it("should not include undefined when TransactionNumber is missing", () => {
      const accountNumber = "123";
      const txWithoutTxNum = {
        ...transaction1,
        rawTransaction: {
          RowNumber: "10",
        },
      } as any;

      const id = transactionUniqueId(
        txWithoutTxNum,
        CompanyTypes.mizrahi,
        accountNumber,
      );

      expect(id).not.toContain("undefined");
    });

    it("should differentiate duplicate identifiers with different TransactionNumbers", () => {
      const accountNumber = "123";
      const baseTx = {
        ...transaction1,
        identifier: "20543",
        chargedAmount: -4000,
      };

      const tx1 = {
        ...baseTx,
        rawTransaction: {
          TransactionNumber: "2",
          RowNumber: "10",
        },
      } as any;

      const tx2 = {
        ...baseTx,
        rawTransaction: {
          TransactionNumber: "1",
          RowNumber: "9",
        },
      } as any;

      const id1 = transactionUniqueId(tx1, CompanyTypes.mizrahi, accountNumber);
      const id2 = transactionUniqueId(tx2, CompanyTypes.mizrahi, accountNumber);

      // tx1 with TransactionNumber=2 should include the number
      expect(id1).toContain("_2");

      // tx2 with TransactionNumber=1 cannot be differentiated (RowNumber is not deterministic)
      // Both will have the same base uniqueId
      expect(id1).not.toBe(id2); // Should be different because one has _2 and other doesn't
    });

    it("should not add TransactionNumber or RowNumber for non-mizrahi banks", () => {
      const accountNumber = "123";
      const tx = {
        ...transaction1,
        rawTransaction: {
          TransactionNumber: "2",
          RowNumber: "10",
        },
      } as any;

      const idHapoalim = transactionUniqueId(
        tx,
        CompanyTypes.hapoalim,
        accountNumber,
      );
      const idMizrahi = transactionUniqueId(
        tx,
        CompanyTypes.mizrahi,
        accountNumber,
      );

      // Hapoalim and Mizrahi should be different (Mizrahi includes TransactionNumber)
      expect(idHapoalim).not.toBe(idMizrahi);

      // Mizrahi should include TransactionNumber at the end
      expect(idMizrahi).toMatch(/_2$/);
    });

    it("should handle missing rawTransaction gracefully", () => {
      const accountNumber = "123";
      const txWithoutRaw = {
        ...transaction1,
      } as any;

      const id = transactionUniqueId(
        txWithoutRaw,
        CompanyTypes.mizrahi,
        accountNumber,
      );

      // Should not throw and should generate a valid unique ID
      expect(id).toBeTruthy();
      expect(typeof id).toBe("string");
      expect(id).not.toContain("undefined");
    });

    it("should handle missing TransactionNumber gracefully", () => {
      const accountNumber = "123";
      const tx = {
        ...transaction1,
        rawTransaction: {
          RowNumber: "10",
        },
      } as any;

      const id = transactionUniqueId(tx, CompanyTypes.mizrahi, accountNumber);

      // Should not append anything since TransactionNumber is missing
      expect(id).not.toContain("undefined");
    });

    it("should handle null TransactionNumber gracefully", () => {
      const accountNumber = "123";
      const tx = {
        ...transaction1,
        rawTransaction: {
          TransactionNumber: null,
          RowNumber: "10",
        },
      } as any;

      const id = transactionUniqueId(tx, CompanyTypes.mizrahi, accountNumber);

      // Should not append anything since TransactionNumber is null
      expect(id).not.toContain("undefined");
      expect(id).not.toContain("null");
    });
  });
});
