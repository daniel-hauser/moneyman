import { YNAB_TOKEN, YNAB_BUDGET_ID, YNAB_ACCOUNTS } from "../config.js";
import { SaveStats, TransactionRow, TransactionStorage } from "../types.js";
import { createLogger } from "./../utils/logger.js";
import { parseISO, format } from "date-fns";
import * as ynab from "ynab";
import hash from "hash-it";

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

  async saveTransactions(txns: Array<TransactionRow>) {
    await this.init();

    // Converting to YNAB format.
    const transactionsFromFinancialAccount = txns.map((tx) =>
      this.convertTransactionToYnabFormat(tx),
    );

    // Filter out transactions with no account number
    const transactionsWithAccount = transactionsFromFinancialAccount.filter(
      (tx) => tx.account_id !== "",
    );

    // Send transactions to YNAB
    logger(`sending to YNAB budget: "${this.budgetName}"`);
    const resp = await this.ynabAPI.transactions.createTransactions(
      YNAB_BUDGET_ID,
      {
        transactions: transactionsWithAccount,
      },
    );
    logger("transactions sent to YNAB successfully!");

    const dups = resp.data.duplicate_import_ids
      ? resp.data.duplicate_import_ids.length
      : 0;
    const noID = txns.length - transactionsWithAccount.length;

    const stats: SaveStats = {
      name: "YNABStorage",
      table: `budget: "${this.budgetName}"`,
      total: transactionsFromFinancialAccount.length,
      added: resp.data.transactions ? resp.data.transactions.length : 0,
      pending: NaN,
      skipped: noID + dups,
      existing: dups,
    };

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
    let jsonData: any;
    try {
      jsonData = JSON.parse(accountsJSON);
    } catch (parseError) {
      const customError = new Error(
        `Error parsing JSON in YNAB_ACCOUNTS: ${parseError.message}`,
      );
      throw customError;
    }

    return new Map(Object.entries(jsonData));
  }

  private convertTransactionToYnabFormat(
    tx: TransactionRow,
  ): ynab.SaveTransaction {
    const amount = Math.round(tx.chargedAmount * 1000);
    const accountId = this.getYnabAccountIdByAccountNumberFromTransaction(
      tx.account,
    );

    return {
      account_id: accountId === null ? "" : accountId,
      date: format(parseISO(tx.date), YNAB_DATE_FORMAT, {}),
      amount,
      payee_id: null,
      payee_name: tx.description,
      cleared: ynab.TransactionClearedStatus.Cleared,
      approved: false,
      import_id: hash(tx.hash).toString(),
      memo: tx.memo,
    };
  }

  private getYnabAccountIdByAccountNumberFromTransaction(
    transactionAccountNumber: string,
  ): string | null {
    const ynabAccountId = this.accountToYnabAccount.get(
      transactionAccountNumber,
    );
    return ynabAccountId || null;
  }
}
