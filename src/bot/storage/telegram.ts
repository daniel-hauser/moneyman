import { sendJSON } from "../notifier.js";
import { createLogger } from "../../utils/logger.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { createSaveStats } from "../saveStats.js";
import { systemName, type MoneymanConfig } from "../../config.js";

const logger = createLogger("TelegramStorage");

export class TelegramStorage implements TransactionStorage {
  constructor(private config: MoneymanConfig) {}

  canSave() {
    // First check if telegram notifications are configured (required for sending)
    const hasTelegramNotifications = Boolean(
      this.config.options.notifications.telegram?.chatId,
    );
    if (!hasTelegramNotifications) {
      return false;
    }

    // If storage.telegram is explicitly configured, use that setting
    if (this.config.storage.telegram !== undefined) {
      return this.config.storage.telegram.enabled;
    }

    // For backward compatibility, default to true if telegram notifications are configured
    return true;
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
