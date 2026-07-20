import { sendJson } from "../notifier.js";
import { createLogger } from "@moneyman/common";
import {
  systemName,
  type ExporterAppConfig,
  type TransactionRow,
} from "@moneyman/protocol";
import type { TransactionStorage } from "../types.js";
import { createSaveStats } from "../saveStats.js";

const logger = createLogger("TelegramStorage");

export class TelegramStorage implements TransactionStorage {
  constructor(private config: ExporterAppConfig) {}

  canSave() {
    return this.config.storage.telegram?.enabled ?? false;
  }

  async saveTransactions(
    transactions: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    logger("saveTransactions");
    await onProgress("Preparing JSON data");
    const stats = createSaveStats("TelegramStorage", undefined, transactions);
    await sendJson(
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
