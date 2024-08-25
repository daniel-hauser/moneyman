import {
  YNAB_TOKEN,
  YNAB_BUDGET_ID,
  YNAB_ACCOUNTS,
  TRANSACTION_HASH_TYPE,
} from "../config/AppConfig.js";
import { SaveStats, TransactionRow, TransactionStorage } from "../types.js";
import { createLogger } from "./../utils/logger.js";
import { parseISO, format } from "date-fns";
import * as ynab from "ynab";
import hash from "hash-it";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { sendDeprecationMessage } from "../notifier.js";

const YNAB_DATE_FORMAT = "yyyy-MM-dd";
const logger = createLogger("YNABStorage");

export class YNABStorage implements TransactionStorage {
  private ynabAPI: ynab.API;
  private budgetName: string;
  private accountToYnabAccount: Map<string, string>;

  async init() {
    logger("init");
    this.ynabAPI = new ynab.API(YNAB_TOKEN);
    this.budgetName = await this.getBudgetName(YNAB_BUDGET_ID);
    this.accountToYnabAccount = this.parseYnabAccounts(YNAB_ACCOUNTS);
  }

  canSave() {
    return Boolean(YNAB_TOKEN && YNAB_BUDGET_ID);
  }

  isDateInFuture(date: string) {
    return new Date(date) > new Date();
  }

  async saveTransactions(txns: Array<TransactionRow>) {
    await this.init();

    const stats = {
      name: "YNABStorage",
      table: `budget: "${this.budgetName}"`,
      total: txns.length,
      added: 0,
      pending: 0,
      existing: 0,
      skipped: 0,
    } satisfies SaveStats;

    // Initialize an array to store non-pending and non-empty account ID transactions on YNAB format.
    const txToSend: ynab.SaveTransactionWithOptionalFields[] = [];
    const missingAccounts = new Set<string>();

    for (let tx of txns) {
      const isPending = tx.status === TransactionStatuses.Pending;
      // YNAB doesn't support future transcation. Will result in 400 Bad Request
      const isDateInFuture = this.isDateInFuture(tx.date);
      if (isPending || isDateInFuture) {
        if (isPending) {
          stats.pending++;
        }
        stats.skipped++;
        continue;
      }

      const accountId = this.accountToYnabAccount.get(tx.account);
      if (!accountId) {
        missingAccounts.add(tx.account);
        stats.skipped++;
        continue;
      }

      // Converting to YNAB format.
      const ynabTx = this.convertTransactionToYnabFormat(tx, accountId);

      // Add non-pending and non-empty account ID transactions to the array.
      txToSend.push(ynabTx);
    }

    if (txToSend.length > 0) {
      // Send transactions to YNAB
      logger(`sending to YNAB budget: "${this.budgetName}"`);
      const resp = await this.ynabAPI.transactions.createTransactions(
        YNAB_BUDGET_ID,
        {
          transactions: txToSend,
        },
      );
      logger("transactions sent to YNAB successfully!");
      stats.added = resp.data.transactions?.length ?? 0;
      stats.existing = resp.data.duplicate_import_ids?.length ?? 0;
      stats.skipped += stats.existing;

      if (TRANSACTION_HASH_TYPE !== "moneyman") {
        sendDeprecationMessage("hashFiledChange");
      }
    }

    if (missingAccounts.size > 0) {
      logger(`Accounts missing in YNAB_ACCOUNTS:`, missingAccounts);
    }

    return stats;
  }

  private async getBudgetName(budgetId: string) {
    const budgetResponse = await this.ynabAPI.budgets.getBudgetById(budgetId);
    if (budgetResponse.data) {
      return budgetResponse.data.budget.name;
    } else {
      throw new Error(`YNAB_BUDGET_ID does not exist in YNAB: ${budgetId}`);
    }
  }

  private parseYnabAccounts(accountsJSON: string): Map<string, string> {
    try {
      const accounts = JSON.parse(accountsJSON);
      return new Map(Object.entries(accounts));
    } catch (parseError) {
      throw new Error(
        `Error parsing JSON in YNAB_ACCOUNTS: ${parseError.message}`,
      );
    }
  }

  private convertTransactionToYnabFormat(
    tx: TransactionRow,
    accountId: string,
  ): ynab.SaveTransactionWithIdOrImportId {
    const amount = Math.round(tx.chargedAmount * 1000);

    return {
      account_id: accountId,
      date: format(parseISO(tx.date), YNAB_DATE_FORMAT, {}),
      amount,
      payee_id: undefined,
      payee_name: tx.description,
      cleared:
        tx.status === TransactionStatuses.Completed
          ? ynab.TransactionClearedStatus.Cleared
          : undefined,
      approved: false,
      import_id: hash(
        TRANSACTION_HASH_TYPE === "moneyman" ? tx.uniqueId : tx.hash,
      ).toString(),
      memo: tx.memo,
    };
  }
}
