import { YNAB_TOKEN, YNAB_BUDGET_ID, YNAB_ACCOUNTS } from "../config.js";
import { SaveStats, TransactionRow, TransactionStorage } from "../types.js";
import { createLogger } from "./../utils/logger.js";
import { parseISO, format } from "date-fns";
import * as ynab from "ynab";
import hash from "hash-it";

const YNAB_DATE_FORMAT = "yyyy-MM-dd";
let ynabAPI: ynab.API;

const logger = createLogger("YNABStorage");

export class YNABStorage implements TransactionStorage {
  async init() {
    logger("init");
  }

  canSave() {
    return Boolean(YNAB_TOKEN && YNAB_BUDGET_ID);
  }

  async saveTransactions(txns: Array<TransactionRow>) {
    await this.init();

    ynabAPI = new ynab.API(YNAB_TOKEN);
    const budgetName = await getBudgetName(YNAB_BUDGET_ID);

    // Convert transactions to YNAB format
    logger("transforming transactions to ynab format");
    const transactionsFromFinancialAccount = txns.map(
      convertTransactionToYnabFormat,
    );

    // Send transactions to YNAB
    logger(`sending to YNAB budget: "${budgetName}"`);
    await ynabAPI.transactions.createTransactions(YNAB_BUDGET_ID, {
      transactions: transactionsFromFinancialAccount,
    });
    logger("transactions sent to YNAB successfully!");

    const stats: SaveStats = {
      name: "YNABStorage",
      table: `budget: "${budgetName}"`,
      total: txns.length,
      added: txns.length,
      pending: NaN,
      skipped: 0,
      existing: NaN,
    };

    return stats;
  }
}

function convertTransactionToYnabFormat(
  tx: TransactionRow,
): ynab.SaveTransaction {
  const amount = Math.round(tx.chargedAmount * 1000);

  return {
    account_id: getYnabAccountIdByAccountNumberFromTransaction(tx.account),
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

function getYnabAccountIdByAccountNumberFromTransaction(
  transactionAccountNumber: string,
): string {
  let jsonData: any;
  try {
    jsonData = JSON.parse(YNAB_ACCOUNTS);
  } catch (parseError) {
    const customError = new Error(
      `Error parsing JSON in YNAB_ACCOUNTS ': ${parseError.message}`,
    );
    throw customError;
  }

  const ynabAccountId = jsonData[transactionAccountNumber];
  if (!ynabAccountId) {
    throw new Error(
      `Cannot found YNAB account UUID for account number ${transactionAccountNumber}`,
    );
  }
  return ynabAccountId;
}

async function getBudgetName(budgetId: string) {
  const budgetResponse = await ynabAPI.budgets.getBudgetById(budgetId);
  if (budgetResponse.data) {
    const budgetName = budgetResponse.data.budget.name;
    return budgetName;
  } else {
    throw new Error(`YNAB_BUDGET_ID does not exists in YNAB ${budgetId}`);
  }
}
