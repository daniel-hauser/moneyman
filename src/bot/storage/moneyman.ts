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
  runId?: string;
}

interface IngestionPayload {
  metadata: IngestionMetadata;
  transactions: IngestionTransactionRow[];
}

interface IngestionResponse {
  success: boolean;
  ingestionId: string;
  transactionsAdded: number;
}

export class MoneymanDashStorage implements TransactionStorage {
  private endpoint?: string;
  private token?: string;
  private lastRunId?: string;

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

    // mm_ token format: mm_<base64url({ u: ingestUrl, k: bearerSecret })>
    if (tokenString.startsWith("mm_")) {
      const encoded = tokenString.slice(3);
      // Restore base64 padding and standard chars
      const base64 = encoded
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), "=");
      const decoded = JSON.parse(Buffer.from(base64, "base64").toString("utf-8"));
      if (!decoded.u || !decoded.k) {
        throw new Error(
          "Invalid mm_ token: missing required fields 'u' (URL) or 'k' (secret)",
        );
      }
      this.endpoint = decoded.u; // full ingest URL, e.g. https://...convex.site/ingest
      this.token = decoded.k; // bearer secret
      return;
    }

    // Legacy format: base64(url).tokenstring
    const dotIndex = tokenString.indexOf(".");
    if (dotIndex === -1) {
      throw new Error(
        "Invalid token format: expected mm_<base64> or base64(url).tokenstring",
      );
    }

    const encodedUrl = tokenString.slice(0, dotIndex);
    const token = tokenString.slice(dotIndex + 1);

    if (!encodedUrl || !token) {
      throw new Error(
        "Invalid token format: both URL and token parts are required",
      );
    }

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

    if (runId) {
      this.lastRunId = runId;
    } else {
      logger("Warning: No runId found in context");
    }

    const payload = this.buildIngestionPayload(nonPendingTxns);

    // Include runId in metadata for server-side correlation
    if (this.lastRunId) {
      payload.metadata.runId = this.lastRunId;
    }

    await onProgress("Sending transactions");

    // endpoint is the full ingest URL from the mm_ token
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
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

    logger(`Ingestion created: ${result.ingestionId}`);

    const stats = createSaveStats("MoneymanDashStorage", "moneyman", txns);
    stats.added = result.transactionsAdded;

    return stats;
  }

  async sendLogs(logs: string) {
    if (!this.endpoint || !this.token) {
      logger("Cannot send logs: token not properly parsed");
      return;
    }

    const runId = this.lastRunId ?? runContextStore.getStore()?.runId;

    if (!runId) {
      logger("Warning: No runId available, skipping log upload");
      return;
    }

    logger("Sending logs");

    // Derive /logs URL from /ingest URL
    const logsUrl = this.endpoint.replace(/\/ingest$/, "/logs");

    if (logsUrl === this.endpoint) {
      logger(
        "Warning: endpoint does not end with /ingest, cannot derive /logs URL — skipping log upload",
      );
      return;
    }

    try {
      const response = await fetch(logsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "text/plain",
          "X-Run-Id": runId,
        },
        body: logs,
      });

      if (!response.ok) {
        logger(
          `Failed to upload logs: ${response.status} ${response.statusText}`,
        );
        return;
      }

      logger("Logs uploaded successfully");
    } catch (e) {
      logger("Error uploading logs", e);
    }
  }

  private toIngestionRow(txn: TransactionRow): IngestionTransactionRow {
    return {
      account: txn.account,
      companyId: txn.companyId,
      hash: txn.hash,
      uniqueId: txn.uniqueId,
      date: txn.date,
      description: txn.description,
      memo: txn.memo,
      originalAmount: txn.originalAmount,
      originalCurrency: txn.originalCurrency,
      chargedAmount: txn.chargedAmount,
      chargedCurrency: txn.chargedCurrency,
      type: txn.type,
      status: txn.status,
      category: txn.category,
    };
  }

  private buildIngestionPayload(txns: TransactionRow[]): IngestionPayload {
    const uniqueAccounts = new Set(txns.map((t) => t.account));

    return {
      metadata: {
        scrapedAt: new Date().toISOString(),
        scrapedBy: "moneyman",
        accounts: uniqueAccounts.size,
        added: txns.length,
        pending: 0,
        skipped: 0,
        highlightedTransactions: 0,
      },
      transactions: txns.map((t) => this.toIngestionRow(t)),
    };
  }
}
