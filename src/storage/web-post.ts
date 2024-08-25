import { createLogger } from "../utils/logger.js";
import type {
  TransactionRow,
  TransactionStorage,
  SaveStats,
} from "../types.js";
import { WEB_POST_URL } from "../config/ScrapeConfig.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { transactionRow } from "./sheets.js";

const logger = createLogger("WebPostStorage");

export class WebPostStorage implements TransactionStorage {
  private url = WEB_POST_URL;

  async init() {
    logger("init");
  }

  canSave() {
    return Boolean(this.url) && URL.canParse(this.url);
  }

  async saveTransactions(txns: Array<TransactionRow>) {
    logger("saveTransactions");
    await this.init();

    const nonPendingTxns = txns.filter(
      (txn) => txn.status !== TransactionStatuses.Pending,
    );

    logger(`Posting ${nonPendingTxns.length} transactions to ${this.url}`);

    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(nonPendingTxns.map((tx) => transactionRow(tx))),
    });

    if (!response.ok) {
      logger(`Failed to post transactions: ${response.statusText}`);
      throw new Error(`Failed to post transactions: ${response.statusText}`);
    }

    const { added = nonPendingTxns.length, skipped = NaN } =
      await response.json();

    const pending = txns.length - nonPendingTxns.length;
    const stats: SaveStats = {
      name: "WebPostStorage",
      table: "web-post",
      total: txns.length,
      added,
      pending,
      skipped: skipped + pending,
      existing: skipped,
    };

    return stats;
  }
}
