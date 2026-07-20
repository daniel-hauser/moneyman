import { CompanyTypes } from "israeli-bank-scrapers";
import type { Transaction } from "israeli-bank-scrapers/lib/transactions.js";
import { transaction } from "@moneyman/protocol/testing";
import { resultsToPayload } from "./payload.js";
import type { AccountScrapeResult } from "./types.js";

describe("resultsToPayload", () => {
  it("waits for invalid-transaction reporting and exports valid rows", async () => {
    let finishReport: (() => void) | undefined;
    const reportError = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReport = resolve;
        }),
    );
    const results: AccountScrapeResult[] = [
      {
        companyId: CompanyTypes.max,
        result: {
          success: true,
          accounts: [
            {
              accountNumber: "synthetic-account",
              txns: [
                {} as Transaction,
                transaction() as unknown as Transaction,
              ],
            },
          ],
        },
      },
    ];

    let settled = false;
    const payloadPromise = resultsToPayload(results, reportError).then(
      (payload) => {
        settled = true;
        return payload;
      },
    );
    await Promise.resolve();

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    finishReport?.();
    const payload = await payloadPromise;

    expect(payload.transactions).toHaveLength(1);
    expect(payload.accountResults).toEqual([
      expect.objectContaining({
        companyId: CompanyTypes.max,
        accountCount: 1,
        txnCount: 2,
      }),
    ]);
  });

  it("keeps the payload when invalid-transaction reporting fails", async () => {
    const reportError = jest.fn().mockRejectedValue(new Error("unavailable"));

    await expect(
      resultsToPayload(
        [
          {
            companyId: CompanyTypes.max,
            result: {
              success: true,
              accounts: [
                {
                  accountNumber: "synthetic-account",
                  txns: [{} as Transaction],
                },
              ],
            },
          },
        ],
        reportError,
      ),
    ).resolves.toEqual({
      accountResults: [
        expect.objectContaining({
          companyId: CompanyTypes.max,
          txnCount: 1,
        }),
      ],
      transactions: [],
    });
  });
});
