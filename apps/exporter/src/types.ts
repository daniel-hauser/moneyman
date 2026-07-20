import type { SaveContext, TransactionRow } from "@moneyman/protocol";
import type { SaveStats } from "./saveStats.js";

export interface TransactionStorage {
  canSave(): boolean;
  saveTransactions(
    transactions: TransactionRow[],
    onProgress: (status: string) => Promise<void>,
    context?: SaveContext,
  ): Promise<SaveStats>;
  sendLogs?(logs: string): Promise<void>;
}
