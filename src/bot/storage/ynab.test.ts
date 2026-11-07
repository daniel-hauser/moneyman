import * as ynab from "ynab";
import { mockDeep } from "jest-mock-extended";
import { config, transactionRow } from "../../utils/tests.js";
import { getSkippedCount } from "../saveStats.js";
import { YNABStorage } from "./ynab.js";
import { stableHash } from "./utils.js";

const mockApi = mockDeep<ynab.API>();
jest.mock("ynab", () => ({
  ...jest.requireActual("ynab"),
  API: jest.fn(() => mockApi),
}));
jest.mock("../../config.js", () => ({ systemName: "moneyman" }));

describe("YNAB statistics", () => {
  afterEach(() => jest.useRealTimers());

  it("counts future dates, unmapped accounts and duplicates correctly", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-02-01"));
    const cfg = config();
    cfg.storage.ynab = {
      token: "test-token",
      budgetId: "test-budget",
      accounts: { "1234": "test-account" },
    };
    mockApi.plans.getPlanById.mockResolvedValue({
      data: {
        plan: { id: "test-budget", name: "Test budget" },
        server_knowledge: 0,
      },
    });
    mockApi.transactions.createTransactions.mockResolvedValue({
      data: {
        transaction_ids: [],
        transactions: [],
        duplicate_import_ids: ["existing"],
        server_knowledge: 0,
      },
    });
    const valid = transactionRow({});
    const txns = [
      transactionRow({ date: "2026-03-01" }),
      transactionRow({ account: "unmapped" }),
      valid,
    ];

    const stats = await new YNABStorage(cfg).saveTransactions(
      txns,
      async () => {},
    );

    expect(mockApi.transactions.createTransactions).toHaveBeenCalledWith(
      "test-budget",
      {
        transactions: [
          expect.objectContaining({
            account_id: "test-account",
            date: "2026-01-30",
            import_id: stableHash(valid.uniqueId),
          }),
        ],
      },
    );
    expect(stats).toMatchObject({
      total: 3,
      added: 0,
      existing: 1,
      pending: 0,
      otherSkipped: 2,
    });
    expect(stats.added + getSkippedCount(stats)).toBe(stats.total);
  });
});
