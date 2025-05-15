import * as actualApi from "@actual-app/api";
import hash from "hash-it";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import fs from "node:fs/promises";
import * as os from "os";
import * as path from "path";
import { TransactionRow, TransactionStorage } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { createSaveStats, SaveStats } from "../saveStats.js";

interface ActualTransaction {
  id?: string;
  account: string;
  date: Date | string;
  amount?: number;
  payee?: string;
  payee_name?: string;
  imported_payee?: string;
  category?: string;
  notes?: string;
  imported_id?: string;
  transfer_id?: string;
  cleared?: boolean;
  subtransactions?: Array<{
    amount: number;
    category_id?: string;
    notes?: string;
  }>;
}

const logger = createLogger("ActualBudgetStorage");

const ACTUAL_SERVER_URL = process.env.ACTUAL_SERVER_URL;
const ACTUAL_PASSWORD = process.env.ACTUAL_PASSWORD;
const ACTUAL_BUDGET_ID = process.env.ACTUAL_BUDGET_ID;
const ACTUAL_ACCOUNTS = process.env.ACTUAL_ACCOUNTS;
const TRANSACTION_HASH_TYPE = process.env.TRANSACTION_HASH_TYPE ?? "moneyman";

export class ActualBudgetStorage implements TransactionStorage {
  private bankToActualAccountMap: Map<string, string>;
  private accountIdToNameMap: Map<string, string>;
  private initialized: boolean = false;

  canSave() {
    return Boolean(
      ACTUAL_SERVER_URL &&
        ACTUAL_BUDGET_ID &&
        ACTUAL_ACCOUNTS &&
        ACTUAL_PASSWORD,
    );
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ): Promise<SaveStats> {
    await Promise.all([onProgress("Initializing"), this.init()]);

    const stats = createSaveStats(
      "ActualBudgetStorage",
      `budget: "${ACTUAL_BUDGET_ID}"`,
      txns,
    );

    const transactionsByActualAccountId = new Map<
      string,
      ActualTransaction[]
    >();

    for (let tx of txns) {
      const isPending = tx.status === TransactionStatuses.Pending;
      if (isPending) {
        stats.skipped++;
        continue;
      }

      const actualAccountId = this.bankToActualAccountMap.get(tx.account);
      if (!actualAccountId) {
        stats.skipped++;
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
      logger(`sending to Actual budget: "${ACTUAL_BUDGET_ID}"`);

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
                  added: 0,
                  updated: 0,
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

        if (TRANSACTION_HASH_TYPE !== "moneyman") {
          logger("Warning: TRANSACTION_HASH_TYPE should be set to 'moneyman'");
        }
      } finally {
        await actualApi.shutdown();
      }
    }
    return stats;
  }

  private async init() {
    if (this.initialized) return;

    logger("init");

    const tempDir = path.join(os.tmpdir(), "moneyman-actual-data");
    const dirExists = await fs.stat(tempDir).catch(() => false);
    if (!dirExists) {
      await fs.mkdir(tempDir, { recursive: true });
    }

    await actualApi.init({
      dataDir: tempDir,
      serverURL: ACTUAL_SERVER_URL,
      password: ACTUAL_PASSWORD,
    });

    await actualApi.downloadBudget(ACTUAL_BUDGET_ID);

    const actualAccounts = await actualApi.getAccounts();
    const validActualAccountIds = new Set(actualAccounts.map((a) => a.id));
    this.accountIdToNameMap = new Map(
      actualAccounts.map((a) => [a.id, a.name]),
    );

    this.bankToActualAccountMap = this.parseActualAccounts(ACTUAL_ACCOUNTS!);

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

    this.initialized = true;
  }

  private parseActualAccounts(accountsJSON: string): Map<string, string> {
    try {
      const accounts = JSON.parse(accountsJSON);
      return new Map(Object.entries(accounts));
    } catch (parseError) {
      throw new Error(
        `Error parsing JSON in ACTUAL_ACCOUNTS: ${parseError.message}`,
      );
    }
  }

  private convertTransactionToActualFormat(
    tx: TransactionRow,
    actualAccountId: string,
  ): ActualTransaction {
    const amount = actualApi.utils.amountToInteger(tx.chargedAmount);

    return {
      account: actualAccountId,
      date: new Date(tx.date),
      amount,
      payee_name: tx.description,
      cleared: tx.status === TransactionStatuses.Completed,
      imported_id: hash(
        TRANSACTION_HASH_TYPE === "moneyman" ? tx.uniqueId : tx.hash,
      ).toString(),
      notes: tx.memo,
    };
  }
}
