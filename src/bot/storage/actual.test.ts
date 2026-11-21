import * as actualApi from "@actual-app/api";
import { ActualBudgetStorage } from "./actual.js";
import { config, transactionRow } from "../../utils/tests.js";
import { mock } from "jest-mock-extended";

jest.mock("@actual-app/api", () => ({
  init: jest.fn(),
  downloadBudget: jest.fn(),
  getAccounts: jest.fn(),
  importTransactions: jest.fn(),
  shutdown: jest.fn(),
  utils: { amountToInteger: jest.fn((amount: number) => amount * 100) },
}));
jest.mock("node:fs/promises", () => ({
  stat: jest.fn().mockResolvedValue({}),
}));

describe("ActualBudgetStorage", () => {
  let storage: ActualBudgetStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    const settings = config();
    settings.storage.actual = {
      serverUrl: "https://actual.example.com",
      password: "invented-password",
      budgetId: "invented-budget",
      accounts: { "1234": "actual-account" },
    };
    storage = new ActualBudgetStorage(settings);
    jest
      .mocked(actualApi.init)
      .mockResolvedValue(mock<Awaited<ReturnType<typeof actualApi.init>>>());
    jest.mocked(actualApi.downloadBudget).mockResolvedValue(undefined);
    jest.mocked(actualApi.getAccounts).mockResolvedValue([
      mock<Awaited<ReturnType<typeof actualApi.getAccounts>>[number]>({
        id: "actual-account",
        name: "Example account",
      }),
    ]);
    jest.mocked(actualApi.shutdown).mockResolvedValue(undefined);
  });

  it.each(["init", "downloadBudget", "getAccounts"] as const)(
    "shuts down when %s fails and preserves the initialization error",
    async (operation) => {
      jest
        .mocked(actualApi[operation])
        .mockRejectedValue(new Error("Initialization failed"));
      jest
        .mocked(actualApi.shutdown)
        .mockRejectedValue(new Error("Shutdown failed"));

      await expect(
        storage.saveTransactions([transactionRow({})], async () => {}),
      ).rejects.toThrow(
        "Failed to initialize Actual Budget: Initialization failed",
      );
      expect(actualApi.shutdown).toHaveBeenCalledTimes(1);
      expect(actualApi.importTransactions).not.toHaveBeenCalled();
    },
  );

  it("shuts down when no configured accounts exist in the downloaded budget", async () => {
    jest.mocked(actualApi.getAccounts).mockResolvedValue([]);

    await expect(
      storage.saveTransactions([transactionRow({})], async () => {}),
    ).rejects.toThrow("No valid account mappings found");
    expect(actualApi.shutdown).toHaveBeenCalledTimes(1);
  });

  it("imports mapped transactions and shuts down after completion", async () => {
    jest.mocked(actualApi.importTransactions).mockResolvedValue({
      errors: [],
      added: ["new-id"],
      updated: ["existing-id"],
      updatedPreview: [],
    });
    const stats = await storage.saveTransactions(
      [
        transactionRow({}),
        transactionRow({ hash: "hash-2", uniqueId: "unique-2" }),
        transactionRow({ account: "unmapped" }),
      ],
      async () => {},
    );

    expect(stats).toMatchObject({ added: 1, existing: 1, otherSkipped: 1 });
    expect(actualApi.importTransactions).toHaveBeenCalledWith(
      "actual-account",
      expect.arrayContaining([
        expect.objectContaining({ account: "actual-account", amount: 1000 }),
      ]),
    );
    expect(actualApi.shutdown).toHaveBeenCalledTimes(1);
  });

  it("still reports shutdown failures when the export itself succeeds", async () => {
    const error = new Error("Shutdown failed");
    jest.mocked(actualApi.shutdown).mockRejectedValue(error);

    await expect(storage.saveTransactions([], async () => {})).rejects.toBe(
      error,
    );
  });
});
