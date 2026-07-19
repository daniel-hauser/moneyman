import { transactionRow, config } from "../../utils/tests.js";
import type { MoneymanConfig } from "../../config.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";

const mockLog = jest.fn();
jest.mock("../../utils/logger.js", () => ({
  createLogger: () => mockLog,
}));

const mockGetPlanById = jest.fn();
const mockGetAccounts = jest.fn();
const mockCreateTransactions = jest.fn();

jest.mock("ynab", () => ({
  API: jest.fn().mockImplementation(() => ({
    plans: { getPlanById: mockGetPlanById },
    accounts: { getAccounts: mockGetAccounts },
    transactions: { createTransactions: mockCreateTransactions },
  })),
  TransactionClearedStatus: { Cleared: "cleared" },
}));

// Import after the mocks are registered so the module under test picks up the
// mocked SDK.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { YNABStorage } = require("./ynab.js");

const mkConfig = (accounts: Record<string, string>): MoneymanConfig => {
  const cfg = config();
  cfg.storage = {
    ynab: {
      token: "test-token",
      budgetId: "test-budget-id",
      accounts,
    },
  };
  return cfg;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPlanById.mockResolvedValue({
    data: { plan: { name: "Test Budget" } },
  });
  mockGetAccounts.mockResolvedValue({
    data: {
      accounts: [
        {
          id: "ynab-hapoalim-uuid",
          name: "Hapoalim",
          closed: false,
          deleted: false,
          transfer_payee_id: "hapoalim-transfer-payee",
        },
        {
          id: "ynab-cal8339-uuid",
          name: "Cal8339",
          closed: false,
          deleted: false,
          transfer_payee_id: "cal8339-transfer-payee",
        },
        {
          id: "ynab-cal7299-uuid",
          name: "Cal7299",
          closed: false,
          deleted: false,
          transfer_payee_id: "cal7299-transfer-payee",
        },
      ],
    },
  });
  mockCreateTransactions.mockResolvedValue({
    data: { transactions: [{}], duplicate_import_ids: [] },
  });
});

describe("YNABStorage transfer routing by identifier", () => {
  const fullConfig = () =>
    mkConfig({
      "hapoalim-acct": "ynab-hapoalim-uuid",
      "8339": "ynab-cal8339-uuid",
      "7299": "ynab-cal7299-uuid",
    });

  it("routes a transaction as a YNAB transfer when tx.identifier matches another configured account", async () => {
    const storage = new YNABStorage(fullConfig());

    const tx = transactionRow({
      account: "hapoalim-acct",
      identifier: "8339",
      description: "כאל",
      chargedAmount: -19198.74,
      status: TransactionStatuses.Completed,
    });

    await storage.saveTransactions([tx], async () => {});

    expect(mockCreateTransactions).toHaveBeenCalledTimes(1);
    const sentTxs = mockCreateTransactions.mock.calls[0][1].transactions;
    expect(sentTxs).toHaveLength(1);
    expect(sentTxs[0]).toMatchObject({
      account_id: "ynab-hapoalim-uuid",
      payee_id: "cal8339-transfer-payee",
    });
    // When sending as a transfer we set payee_id only — payee_name must be
    // absent so YNAB derives the display name from the transfer target.
    expect(sentTxs[0].payee_name).toBeUndefined();
  });

  it("sends a normal transaction (no transfer) when tx.identifier is missing", async () => {
    const storage = new YNABStorage(fullConfig());

    const tx = transactionRow({
      account: "8339",
      identifier: undefined,
      description: "BIT",
      chargedAmount: -50,
      status: TransactionStatuses.Completed,
    });

    await storage.saveTransactions([tx], async () => {});

    const sentTx = mockCreateTransactions.mock.calls[0][1].transactions[0];
    expect(sentTx.payee_id).toBeUndefined();
    expect(sentTx.payee_name).toBe("BIT");
  });

  it("sends a normal transaction when tx.identifier matches no configured account", async () => {
    const storage = new YNABStorage(fullConfig());

    const tx = transactionRow({
      account: "hapoalim-acct",
      identifier: "9999", // not in the accounts map
      description: "Some Merchant",
      chargedAmount: -100,
      status: TransactionStatuses.Completed,
    });

    await storage.saveTransactions([tx], async () => {});

    const sentTx = mockCreateTransactions.mock.calls[0][1].transactions[0];
    expect(sentTx.payee_id).toBeUndefined();
    expect(sentTx.payee_name).toBe("Some Merchant");
  });

  it("does not self-transfer when tx.identifier resolves to the same account as tx.account", async () => {
    const storage = new YNABStorage(fullConfig());

    const tx = transactionRow({
      account: "8339",
      identifier: "8339", // same as source
      description: "Some Merchant",
      chargedAmount: -75,
      status: TransactionStatuses.Completed,
    });

    await storage.saveTransactions([tx], async () => {});

    const sentTx = mockCreateTransactions.mock.calls[0][1].transactions[0];
    expect(sentTx.payee_id).toBeUndefined();
    expect(sentTx.payee_name).toBe("Some Merchant");
  });

  it("logs a debug line when a transaction is routed as a transfer", async () => {
    const storage = new YNABStorage(fullConfig());

    const tx = transactionRow({
      account: "hapoalim-acct",
      identifier: "8339",
      description: "כאל",
      chargedAmount: -19198.74,
      status: TransactionStatuses.Completed,
    });

    await storage.saveTransactions([tx], async () => {});

    const transferLogCall = mockLog.mock.calls.find(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("routing tx as transfer"),
    );
    expect(transferLogCall).toBeDefined();
    expect(transferLogCall[0]).toContain("8339");
  });

  it("falls back to a normal transaction when the target account has no transfer_payee_id (e.g. closed account)", async () => {
    // Replace the Cal8339 account with one that has no transfer_payee_id.
    mockGetAccounts.mockResolvedValueOnce({
      data: {
        accounts: [
          {
            id: "ynab-hapoalim-uuid",
            name: "Hapoalim",
            closed: false,
            deleted: false,
            transfer_payee_id: "hapoalim-transfer-payee",
          },
          {
            id: "ynab-cal8339-uuid",
            name: "Cal8339 (closed)",
            closed: true,
            deleted: false,
            transfer_payee_id: null,
          },
        ],
      },
    });

    const storage = new YNABStorage(fullConfig());

    const tx = transactionRow({
      account: "hapoalim-acct",
      identifier: "8339",
      description: "כאל",
      chargedAmount: -19198.74,
      status: TransactionStatuses.Completed,
    });

    await storage.saveTransactions([tx], async () => {});

    const sentTx = mockCreateTransactions.mock.calls[0][1].transactions[0];
    expect(sentTx.payee_id).toBeUndefined();
    expect(sentTx.payee_name).toBe("כאל");
  });
});
