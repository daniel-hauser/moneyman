import { config, transactionRow } from "@moneyman/protocol/testing";
import { TelegramStorage } from "./telegram.js";
import { sendJson } from "../notifier.js";

jest.mock("../notifier.js", () => ({
  sendJson: jest.fn(),
}));

describe("TelegramStorage", () => {
  it("is disabled when Telegram storage is not configured", () => {
    const storage = new TelegramStorage(config());
    expect(storage.canSave()).toBe(false);
  });

  it("is enabled only by its exporter storage setting", () => {
    const appConfig = config();
    appConfig.storage = { telegram: { enabled: true } };
    const storage = new TelegramStorage(appConfig);
    expect(storage.canSave()).toBe(true);
  });

  it("sends transactions through the notifier service", async () => {
    const appConfig = config();
    appConfig.storage = { telegram: { enabled: true } };
    const storage = new TelegramStorage(appConfig);
    const transactions = [transactionRow()];

    await storage.saveTransactions(transactions, async () => {});

    expect(sendJson).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          name: "TelegramStorage",
        }),
        transactions,
      }),
      "transactions.txt",
    );
  });
});
