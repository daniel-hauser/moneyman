import * as actualApi from "@actual-app/api";
import { stableHash } from "./utils.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import assert from "node:assert";
import fs from "node:fs/promises";
import * as os from "os";
import * as path from "path";
import type { MoneymanConfig } from "../../config.js";
import { TransactionRow, TransactionStorage } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { formatUnknownError } from "../../utils/utils.js";
import { createSaveStats, SaveStats } from "../saveStats.js";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { spanEvent } from "../../utils/telemetry.js";

const logger = createLogger("ActualBudgetStorage");
type ImportTransactionEntity = Parameters<
  typeof actualApi.importTransactions
>[1][number];

export class ActualBudgetStorage implements TransactionStorage {
  private bankToActualAccountMap = new Map<string, string>();
  private accountIdToNameMap = new Map<string, string>();

  constructor(private config: MoneymanConfig) {}

  canSave() {
    return Boolean(this.config.storage.actual);
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ): Promise<SaveStats> {
    await Promise.all([onProgress("Initializing"), this.init()]);

    const stats = createSaveStats(
      "ActualBudgetStorage",
      `budget: "${this.config.storage.actual?.budgetId || "unknown"}"`,
      txns,
    );

    try {
      const transactionsByActualAccountId = new Map<
        string,
        ImportTransactionEntity[]
      >();

      for (let tx of txns) {
        const isPending = tx.status === TransactionStatuses.Pending;
        if (isPending) {
          continue;
        }

        const actualAccountId = this.bankToActualAccountMap.get(tx.account);
        if (!actualAccountId) {
          stats.otherSkipped++;
          continue;
        }

        const actualTx = this.convertTransactionToActualFormat(
          tx,
          actualAccountId,
        );

        if (!transactionsByActualAccountId.has(actualAccountId)) {
          transactionsByActualAccountId.set(actualAccountId, []);
        }
        transactionsByActualAccountId.get(actualAccountId)!.push(actualTx);
      }

      if (transactionsByActualAccountId.size > 0) {
        await this.sendTransactionsToActual(
          transactionsByActualAccountId,
          stats,
          onProgress,
        );
      }
    } finally {
      await actualApi.shutdown();
    }
    return stats;
  }

  private async sendTransactionsToActual(
    transactionsByActualAccountId: Map<string, ImportTransactionEntity[]>,
    stats: SaveStats,
    onProgress: (status: string) => Promise<void>,
  ) {
    try {
      for (const [
        actualAccountId,
        transactions,
      ] of transactionsByActualAccountId) {
        const accountName =
          this.accountIdToNameMap.get(actualAccountId) || actualAccountId;
        spanEvent("storage.import", {
          "account.name": accountName,
          "transaction.count": transactions.length,
        });
        const [, importResponse] = await Promise.all([
          onProgress(`Sending transactions for account "${accountName}"`),
          actualApi
            .importTransactions(actualAccountId, transactions)
            .catch((error) => {
              trace
                .getActiveSpan()
                ?.recordException(
                  error instanceof Error ? error : String(error),
                );
              logger(
                `Error importing transactions for account "${accountName}": ${error.message}`,
              );
              return {
                errors: [error.message],
                added: [],
                updated: [],
              };
            }),
        ]);

        if (importResponse.errors?.length) {
          trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR });
          logger(
            `Errors importing transactions: ${JSON.stringify(importResponse.errors)}`,
          );
          continue;
        }

        trace.getActiveSpan()?.addEvent("storage.imported", {
          "account.name": accountName,
          "transaction.added": importResponse.added?.length || 0,
          "transaction.updated": importResponse.updated?.length || 0,
        });
        stats.added += importResponse.added?.length || 0;
        stats.existing += importResponse.updated?.length || 0;
      }

      if (this.config.options.scraping.transactionHashType !== "moneyman") {
        logger("Warning: transactionHashType should be set to 'moneyman'");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to send transactions to Actual: ${message}`);
    }
  }

  private async init() {
    spanEvent("storage.initialize");
    const actualConfig = this.config.storage.actual;
    assert(actualConfig, "Actual storage is not configured");
    trace
      .getActiveSpan()
      ?.setAttribute("storage.budget_id", actualConfig.budgetId);

    try {
      const tempDir = path.join(os.tmpdir(), "moneyman-actual-data");
      const dirExists = await fs.stat(tempDir).catch(() => false);
      if (!dirExists) {
        await fs.mkdir(tempDir, { recursive: true });
      }

      spanEvent("storage.connect");
      await actualApi.init({
        dataDir: tempDir,
        serverURL: actualConfig.serverUrl,
        password: actualConfig.password,
      });

      spanEvent("storage.load_budget");
      await actualApi.downloadBudget(actualConfig.budgetId);

      spanEvent("storage.load_accounts");
      const actualAccounts = await actualApi.getAccounts();
      const validActualAccountIds = new Set(actualAccounts.map((a) => a.id));
      this.accountIdToNameMap = new Map(
        actualAccounts.map((a) => [a.id, a.name]),
      );

      this.bankToActualAccountMap = new Map(
        Object.entries(actualConfig.accounts),
      );

      for (const [
        bankAccountId,
        actualAccountId,
      ] of this.bankToActualAccountMap.entries()) {
        if (!validActualAccountIds.has(actualAccountId)) {
          const accountName =
            this.accountIdToNameMap.get(actualAccountId) || actualAccountId;
          logger(
            `Warning: Actual Budget account "${accountName}" for bank account ${bankAccountId} does not exist`,
          );
          this.bankToActualAccountMap.delete(bankAccountId);
        }
      }

      if (this.bankToActualAccountMap.size === 0) {
        throw new Error(
          "No valid account mappings found. Please check ACTUAL_ACCOUNTS configuration.",
        );
      }
    } catch (error) {
      throw new Error(
        `Failed to initialize Actual Budget: ${formatUnknownError(error)}`,
      );
    }
  }

  private convertTransactionToActualFormat(
    tx: TransactionRow,
    actualAccountId: string,
  ): ImportTransactionEntity {
    assert(
      tx.chargedAmount !== null,
      "Cannot export a null charged amount to Actual Budget",
    );
    const amount = actualApi.utils.amountToInteger(tx.chargedAmount);

    return {
      account: actualAccountId,
      date: new Date(tx.date).toISOString().split("T")[0],
      amount,
      payee_name: tx.description,
      cleared: tx.status === TransactionStatuses.Completed,
      imported_id: stableHash(
        this.config.options.scraping.transactionHashType === "moneyman"
          ? tx.uniqueId
          : tx.hash,
      ),
      notes: tx.memo,
    };
  }
}
