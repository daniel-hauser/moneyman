import * as actualApi from "@actual-app/api";
import { ImportTransactionEntity } from "@actual-app/api/@types/loot-core/src/types/models/index.js";
import hash from "hash-it";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import assert from "node:assert";
import fs from "node:fs/promises";
import * as os from "os";
import * as path from "path";
import type { MoneymanConfig } from "../../config.js";
import { TransactionRow, TransactionStorage } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { createSaveStats, SaveStats } from "../saveStats.js";

const logger = createLogger("ActualBudgetStorage");

export class ActualBudgetStorage implements TransactionStorage {
  private bankToActualAccountMap: Map<string, string>;
  private accountIdToNameMap: Map<string, string>;

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
    logger(
      `sending to Actual budget: "${this.config.storage.actual?.budgetId}"`,
    );

    try {
      for (const [
        actualAccountId,
        transactions,
      ] of transactionsByActualAccountId) {
        const accountName =
          this.accountIdToNameMap.get(actualAccountId) || actualAccountId;
        logger(
          `Processing ${transactions.length} transactions for account "${accountName}"`,
        );
        const [importResponse] = await Promise.all([
          actualApi
            .importTransactions(actualAccountId, transactions)
            .catch((error) => {
              logger(
                `Error importing transactions for account "${accountName}": ${error.message}`,
              );
              return {
                errors: [error.message],
                added: [],
                updated: [],
              };
            }),
          onProgress(`Sending transactions for account "${accountName}"`),
        ]);

        if (importResponse.errors?.length) {
          logger(
            `Errors importing transactions: ${JSON.stringify(importResponse.errors)}`,
          );
          continue;
        }

        logger(
          `Imported ${importResponse.added?.length || 0} transactions for account "${accountName}"`,
        );
        stats.added += importResponse.added?.length || 0;
        stats.existing += importResponse.updated?.length || 0;
      }

      logger("transactions sent to Actual successfully!");

      if (this.config.options.scraping.transactionHashType !== "moneyman") {
        logger("Warning: transactionHashType should be set to 'moneyman'");
      }
    } catch (error) {
      throw new Error(
        `Failed to send transactions to Actual: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async init() {
    logger("init");
    const actualConfig = this.config.storage.actual;
    assert(actualConfig, "Actual storage is not configured");

    try {
      const tempDir = path.join(os.tmpdir(), "moneyman-actual-data");
      const dirExists = await fs.stat(tempDir).catch(() => false);
      if (!dirExists) {
        await fs.mkdir(tempDir, { recursive: true });
      }

      await actualApi.init({
        dataDir: tempDir,
        serverURL: actualConfig.serverUrl,
        password: actualConfig.password,
      });

      await actualApi.downloadBudget(actualConfig.budgetId);

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
        `Failed to initialize Actual Budget: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private convertTransactionToActualFormat(
    tx: TransactionRow,
    actualAccountId: string,
  ): ImportTransactionEntity {
    const amount = actualApi.utils.amountToInteger(tx.chargedAmount);

    return {
      account: actualAccountId,
      date: new Date(tx.date).toISOString().split("T")[0],
      amount,
      payee_name: tx.description,
      cleared: tx.status === TransactionStatuses.Completed,
      imported_id: hash(
        this.config.options.scraping.transactionHashType === "moneyman"
          ? tx.uniqueId
          : tx.hash,
      ).toString(),
      notes: tx.memo,
    };
  }
}
