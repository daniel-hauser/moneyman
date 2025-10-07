import { createLogger } from "../../utils/logger.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { createSaveStats } from "../saveStats.js";
import type { MoneymanConfig } from "../../config.js";

const logger = createLogger("sql-storage");

export class SqlStorage implements TransactionStorage {
  constructor(private readonly config: MoneymanConfig) {}

  canSave(): boolean {
    return Boolean(this.config.storage.sql?.connectionString);
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    logger(`Saving ${txns.length} transactions to SQL`);
    onProgress("noop");
    return createSaveStats("Postgres", undefined, txns);
  }
}
