import { sendJSON } from "../notifier.ts";
import { createLogger } from "@moneyman/common";
import type { TransactionRow, TransactionStorage } from "../../types.ts";
import { createSaveStats } from "../saveStats.ts";
import { systemName } from "../../config.ts";
import type { TelegramStorageConfigType } from "../../config/storage.schema.ts";

const logger = createLogger("TelegramStorage");

export class TelegramStorage implements TransactionStorage {
  constructor(private config: TelegramStorageConfigType) {}

  canSave() {
    // Enable if we have a chat ID, the API key will be checked in notifier
    return Boolean(this.config?.chatId);
  }

  async saveTransactions(
    transactions: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    logger("saveTransactions");
    await onProgress("Preparing JSON data");
    const stats = createSaveStats("TelegramStorage", undefined, transactions);
    await sendJSON(
      {
        metadata: {
          ...stats,
          scrapedBy: systemName,
          scrapedAt: new Date().toISOString(),
        },
        transactions,
      },
      `transactions.txt`,
    );

    return stats;
  }
}
