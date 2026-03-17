import { createLogger } from "../../utils/logger.js";
import type {
  AccountStatus,
  TransactionRow,
  TransactionStorage,
  SaveContext,
} from "../../types.js";
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
  accountStatuses?: AccountStatus[];
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
    if (!tokenString.startsWith(MM_PREFIX)) {
      throw new Error(
        "Invalid token format: expected mm_<base64url encoded token>",
      );
    }

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
    context?: SaveContext,
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
      this.lastRunId = undefined;
    }

    const payload = this.buildIngestionPayload(nonPendingTxns, context);

    // Include runId in metadata for server-side correlation
    if (this.lastRunId) {
      payload.metadata.runId = this.lastRunId;
    }

    // Run progress update in parallel with the network request
    const signal = AbortSignal.timeout(30_000);
    const [response] = await Promise.all([
      fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal,
      }),
      onProgress("Sending transactions"),
    ]);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const detail = body ? `: ${body}` : "";
      logger(
        `Failed to post transactions: ${response.status} ${response.statusText}${detail}`,
      );
      throw new Error(
        `Failed to post transactions: ${response.status} ${response.statusText}${detail}`,
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
      const signal = AbortSignal.timeout(15_000);
      const response = await fetch(logsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "text/plain",
          "X-Run-Id": runId,
        },
        body: logs,
        signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const detail = body ? `: ${body}` : "";
        logger(
          `Failed to upload logs: ${response.status} ${response.statusText}${detail}`,
        );
        return;
      }

      logger("Logs uploaded successfully");
    } catch (e) {
      logger("Error uploading logs", e);
    }
  }

  private buildIngestionPayload(
    txns: TransactionRow[],
    context?: SaveContext,
  ): IngestionPayload {
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
        // Per-account scraping results (success/failure per bank/credit card)
        accountStatuses: context?.accountResults,
      },
      transactions: txns,
    };
  }
}
