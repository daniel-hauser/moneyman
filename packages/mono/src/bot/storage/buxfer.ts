import type { TransactionRow, TransactionStorage } from "../../types.ts";
import { createLogger } from "@moneyman/common";
import { format, parseISO } from "date-fns";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import type { BuxferTransaction } from "buxfer-ts-client";
import { BuxferApiClient } from "buxfer-ts-client";
import { createSaveStats } from "../saveStats.ts";
import type { BuxferConfigType } from "../../config/storage.schema.ts";

const BUXFER_DATE_FORMAT = "yyyy-MM-dd";
const logger = createLogger("BuxferStorage");

export class BuxferStorage implements TransactionStorage {
  private buxferClient: BuxferApiClient;
  private accountToBuxferAccount: Map<string, string>;

  constructor(private config: BuxferConfigType) {}

  async init() {
    logger("init");
    this.buxferClient = new BuxferApiClient(
      this.config.username,
      this.config.password,
    );
    this.accountToBuxferAccount = new Map(Object.entries(this.config.accounts));
  }

  canSave() {
    return Boolean(
      this.config?.username && this.config?.password && this.config?.accounts,
    );
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    await this.init();

    const stats = createSaveStats(
      "BuxferStorage",
      `Accounts: "${Array.from(this.accountToBuxferAccount.keys())}"`,
      txns,
    );

    // Initialize an array to store non-pending and non-empty account ID transactions on Buxfer format.
    const txToSend: BuxferTransaction[] = [];
    const missingAccounts = new Set<string>();

    for (const tx of txns) {
      const isPending = tx.status === TransactionStatuses.Pending;
      // Ignore pending and only upload completed transactions
      if (isPending) {
        stats.skipped++;
        continue;
      }

      const accountId = this.accountToBuxferAccount.get(tx.account);
      if (!accountId) {
        missingAccounts.add(tx.account);
        stats.skipped++;
        continue;
      }

      // Converting to Buxfer format.
      const buxferTx = this.convertTransactionToBuxferFormat(tx, accountId);

      // Add non-pending and non-empty account ID transactions to the array.
      txToSend.push(buxferTx);
    }

    if (txToSend.length > 0) {
      // TODO - Build JSON based personal rule engine for tagging transactions
      this.tagTransactionsByRules(txToSend);

      // Send transactions to Buxfer
      logger(
        `sending to Buxfer accounts: "${this.accountToBuxferAccount.keys()}"`,
      );
      const [resp] = await Promise.all([
        this.buxferClient.addTransactions(txToSend, false),
        onProgress("Sending"),
      ]);
      logger("transactions sent to Buxfer successfully!");
      stats.added = resp.addedTransactionIds.length;
      stats.existing = resp.existingTransactionIds.length;
      stats.skipped += stats.existing;
    }

    if (missingAccounts.size > 0) {
      logger(`Accounts missing in Buxfer_ACCOUNTS:`, missingAccounts);
    }

    return stats;
  }

  tagTransactionsByRules(txToSend: BuxferTransaction[]) {
    // TODO - Implement declarative rule engine
    const tags: string[] = ["added-by-moneyman-etl"];
    txToSend.forEach((trx) => {
      trx.tags = `${tags}`;
    });
  }

  private convertTransactionToBuxferFormat(
    tx: TransactionRow,
    accountId: string,
  ): BuxferTransaction {
    return {
      accountId: Number(accountId),
      date: format(parseISO(tx.date), BUXFER_DATE_FORMAT, {}),
      amount: tx.chargedAmount,
      description: [tx.description, tx.memo].filter(Boolean).join(" | "), // Buxfer does not allow updating all trx fields via REST API so this will add additional fields to the description with '|' separators
      status:
        tx.status === TransactionStatuses.Completed ? "cleared" : "pending",
      type: tx.chargedAmount > 0 ? "income" : "expense",
    };
  }
}
