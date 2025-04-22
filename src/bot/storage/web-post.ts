import { createLogger } from "../../utils/logger.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { tableRow } from "../transactionTableRow.js";
import { createSaveStats } from "../saveStats.js";
import { WebPostConfigType } from "../../config/storage.schema.js";

const logger = createLogger("WebPostStorage");

export class WebPostStorage implements TransactionStorage {
  constructor(private config: WebPostConfigType) {}

  canSave() {
    return Boolean(this.config?.url) && URL.canParse(this.config.url);
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    logger("saveTransactions");

    const nonPendingTxns = txns.filter(
      (txn) => txn.status !== TransactionStatuses.Pending,
    );

    logger(
      `Posting ${nonPendingTxns.length} transactions to ${this.config.url}`,
    );

    const [response] = await Promise.all([
      fetch(this.config.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.config.authorizationToken && {
            Authorization: this.config.authorizationToken,
          }),
        },
        body: JSON.stringify(nonPendingTxns.map((tx) => tableRow(tx))),
      }),
      onProgress("Sending"),
    ]);

    if (!response.ok) {
      logger(`Failed to post transactions: ${response.statusText}`);
      throw new Error(`Failed to post transactions: ${response.statusText}`);
    }

    const res = (await response.json()) as Record<string, number>;

    const stats = createSaveStats("WebPostStorage", "web-post", txns);
    stats.added = res.added ?? nonPendingTxns.length;
    stats.skipped += stats.pending;

    return stats;
  }
}
