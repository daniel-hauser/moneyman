import { createLogger } from "../../utils/logger.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { tableRow } from "../transactionTableRow.js";
import { createSaveStats } from "../saveStats.js";
import type { MoneymanConfig } from "../../config.js";
import assert from "node:assert";

const logger = createLogger("WebPostStorage");

export class WebPostStorage implements TransactionStorage {
  constructor(private config: MoneymanConfig) {}

  canSave() {
    return Boolean(this.config.storage.webPost?.url);
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    logger("saveTransactions");

    const webPostConfig = this.config.storage.webPost;
    assert(webPostConfig, "Web Post configuration not found");

    const nonPendingTxns = txns.filter(
      (txn) => txn.status !== TransactionStatuses.Pending,
    );

    logger(
      `Posting ${nonPendingTxns.length} transactions to ${webPostConfig.url}`,
    );

    const [response] = await Promise.all([
      fetch(webPostConfig.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: webPostConfig.authorizationToken,
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

    return stats;
  }
}
