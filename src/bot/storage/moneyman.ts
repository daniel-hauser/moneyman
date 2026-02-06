import { createLogger } from "../../utils/logger.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { createSaveStats } from "../saveStats.js";
import type { MoneymanConfig } from "../../config.js";
import { runContextStore } from "../../utils/asyncContext.js";
import assert from "node:assert";

const logger = createLogger("MoneymanDashStorage");

interface IngestionTransactionRow {
  account: string;
  companyId: string;
  hash: string;
  uniqueId: string;
  date: string;
  description: string;
  memo?: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency?: string;
  type: string;
  status: string;
  category?: string;
}

interface IngestionMetadata {
  scrapedAt: string;
  scrapedBy: string;
  accounts: number;
  added: number;
  pending: number;
  skipped: number;
  highlightedTransactions: number;
}

interface IngestionPayload {
  metadata: IngestionMetadata;
  transactions: IngestionTransactionRow[];
}

interface IngestionResponse {
  id: string;
  added: number;
  pending: number;
  skipped: number;
  status: "success" | "partial" | "failed";
}

export class MoneymanDashStorage implements TransactionStorage {
  private endpoint?: string;
  private token?: string;

  constructor(private config: MoneymanConfig) {
    if (this.canSave()) {
      try {
        this.parseToken();
      } catch (e) {
        logger("Failed to parse token", e);
      }
    }
  }

  private parseToken() {
    const tokenConfig = this.config.storage.moneyman;
    assert(tokenConfig, "Moneyman storage configuration not found");

    const tokenString = tokenConfig.token;
    const parts = tokenString.split(".");

    if (parts.length !== 2) {
      throw new Error(
        "Invalid token format: expected base64(url).tokenstring"
      );
    }

    const [encodedUrl, token] = parts;

    try {
      const url = Buffer.from(encodedUrl, "base64").toString("utf-8");
      this.endpoint = url;
      this.token = token;
    } catch (e) {
      throw new Error("Failed to decode token URL from base64", { cause: e });
    }
  }

  canSave() {
    return Boolean(this.config.storage.moneyman?.token);
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>
  ) {
    logger("saveTransactions");

    assert(this.endpoint && this.token, "Token not properly parsed");

    const nonPendingTxns = txns.filter(
      (txn) => txn.status !== TransactionStatuses.Pending
    );

    logger(
      `Posting ${nonPendingTxns.length} transactions to ${this.endpoint}`
    );

    const runContext = runContextStore.getStore();
    const runId = runContext?.runId;

    if (!runId) {
      logger("Warning: No runId found in context");
    }

    const payload = this.buildIngestionPayload(nonPendingTxns);

    await onProgress("Sending transactions");

    const response = await fetch(`${this.endpoint}/api/ingest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        ...(runId && { runId }),
      }),
    });

    if (!response.ok) {
      logger(
        `Failed to post transactions: ${response.status} ${response.statusText}`
      );
      throw new Error(
        `Failed to post transactions: ${response.status} ${response.statusText}`
      );
    }

    const result = (await response.json()) as IngestionResponse;

    logger(`Transactions posted successfully: ${result.id}`);

    const stats = createSaveStats("MoneymanDashStorage", "moneyman", txns);
    stats.added = result.added;
    stats.otherSkipped = result.skipped;

    return stats;
  }

  async sendLogs(logs: string) {
    if (!this.endpoint || !this.token) {
      logger("Cannot send logs: token not properly parsed");
      return;
    }

    const runContext = runContextStore.getStore();
    const runId = runContext?.runId;

    if (!runId) {
      logger("Warning: No runId found in context, skipping log upload");
      return;
    }

    logger("Sending logs");

    const formData = new FormData();
    formData.append("log", new Blob([logs], { type: "text/plain" }), "scraper.log");
    formData.append("runId", runId);

    try {
      const response = await fetch(`${this.endpoint}/api/ingest/logs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        logger(
          `Failed to upload logs: ${response.status} ${response.statusText}`
        );
        return;
      }

      logger("Logs uploaded successfully");
    } catch (e) {
      logger("Error uploading logs", e);
    }
  }

  private buildIngestionPayload(txns: IngestionTransactionRow[]): IngestionPayload {
    const uniqueAccounts = new Set(txns.map((t) => t.account));
    const addedCount = txns.length;
    const pendingCount = 0;
    const skippedCount = 0;

    return {
      metadata: {
        scrapedAt: new Date().toISOString(),
        scrapedBy: "moneyman",
        accounts: uniqueAccounts.size,
        added: addedCount,
        pending: pendingCount,
        skipped: skippedCount,
        highlightedTransactions: 0,
      },
      transactions: txns,
    };
  }
}
