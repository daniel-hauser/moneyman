import { sendJSON } from "../notifier.js";
import { createLogger } from "../../utils/logger.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { createSaveStats } from "../saveStats.js";
import { systemName } from "../../config.js";

const logger = createLogger("TelegramStorage");

export class TelegramStorage implements TransactionStorage {
  canSave() {
    // Enable if we have a chat ID, the API key will be checked in notifier
    return Boolean(process.env.TELEGRAM_CHAT_ID);
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
