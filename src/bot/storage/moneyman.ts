import { createLogger } from "../../utils/logger.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { createSaveStats } from "../saveStats.js";
import type { MoneymanConfig } from "../../config.js";
import { runContextStore } from "../../utils/asyncContext.js";
import assert from "node:assert";

const logger = createLogger("MoneymanDashStorage");
const MM_PREFIX = "mm_";

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
  transactions: TransactionRow[];
}

interface IngestionResponse {
  success: boolean;
  transactionsAdded: number;
}

export class MoneymanDashStorage implements TransactionStorage {
  private endpoint?: string;
  private token?: string;
  private lastRunId?: string;

  constructor(private config: MoneymanConfig) {
    if (this.config.storage.moneyman?.token) {
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
    if (tokenString.startsWith(MM_PREFIX)) {
      const encoded = tokenString.slice(MM_PREFIX.length);
      // Restore base64 padding and standard chars
      const base64 = encoded
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), "=");
      const raw = JSON.parse(Buffer.from(base64, "base64").toString("utf-8"));
      // Protect against prototype pollution — only extract known fields
      const decoded = { u: raw.u, k: raw.k };
      if (!decoded.u || !decoded.k) {
        throw new Error(
          "Invalid mm_ token: missing required fields 'u' (URL) or 'k' (secret)",
        );
      }
      this.validateEndpointUrl(decoded.u);
      this.endpoint = decoded.u;
      this.token = decoded.k;
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
      this.validateEndpointUrl(url);
      this.endpoint = url;
      this.token = token;
    } catch (e) {
      throw new Error("Failed to decode token URL from base64", { cause: e });
    }
  }

  private validateEndpointUrl(url: string) {
    if (!URL.canParse(url)) {
      throw new Error("Invalid endpoint URL in token");
    }
    const { protocol } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") {
      throw new Error("Endpoint URL must use http(s) protocol");
    }
  }

  canSave() {
    return Boolean(this.endpoint && this.token);
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    logger("saveTransactions");

    assert(this.canSave(), "Token not properly parsed");
    // canSave() guarantees these are set
    const endpoint = this.endpoint!;
    const token = this.token!;

    const nonPendingTxns = txns.filter(
      (txn) => txn.status !== TransactionStatuses.Pending,
    );

    logger(`Posting ${nonPendingTxns.length} transactions to ${endpoint}`);

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

    // Run progress update in parallel with the network request
    const [response] = await Promise.all([
      fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
      onProgress("Sending transactions"),
    ]);

    if (!response.ok) {
      logger(
        `Failed to post transactions: ${response.status} ${response.statusText}`,
      );
      throw new Error(
        `Failed to post transactions: ${response.status} ${response.statusText}`,
      );
    }

    const result = (await response.json()) as IngestionResponse;

    if (typeof result.transactionsAdded !== "number") {
      throw new Error(
        `Unexpected ingestion response shape: ${JSON.stringify(result)}`,
      );
    }

    logger(
      `Ingestion complete: ${result.transactionsAdded} transactions added`,
    );

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

    const logsUrl = `${this.endpoint}/logs`;

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

  private buildIngestionPayload(txns: TransactionRow[]): IngestionPayload {
    const uniqueAccounts = new Set(txns.map((t) => t.account));

    return {
      metadata: {
        scrapedAt: new Date().toISOString(),
        scrapedBy: "moneyman",
        accounts: uniqueAccounts.size,
        added: txns.length,
        // txns is already filtered to non-pending (see caller).
        // Moneyman doesn't track pending/skipped/highlighted at this level.
        pending: 0,
        skipped: 0,
        highlightedTransactions: 0,
      },
      transactions: txns,
    };
  }
}
