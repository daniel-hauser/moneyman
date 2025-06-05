import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { AccountScrapeResult, Transaction } from "../types.js";
import { normalizeCurrency } from "../utils/currency.js";
import { Timer } from "../utils/Timer.js";

export function getSummaryMessages(results: Array<AccountScrapeResult>) {
  const errorAccounts: string[] = [];
  const successAccounts: string[] = [];

  results.forEach(({ result, companyId }) => {
    if (!result.success) {
      errorAccounts.push(
        `\t❌ [${companyId}] ${result.errorType}${
          result.errorMessage ? `\n\t\t${result.errorMessage}` : ""
        }`,
      );
    } else {
      result.accounts?.forEach((account) => {
        successAccounts.push(
          `\t✔️ [${companyId}] ${account.accountNumber}: ${account.txns.length}`,
        );
      });
    }
  });

  const { pending, completed } = transactionsByStatus(results);

  let accountsSection = "";

  if (errorAccounts.length === 0 && successAccounts.length === 0) {
    accountsSection = "\t😶 None";
  } else {
    // Show error accounts first (outside expandable block)
    if (errorAccounts.length > 0) {
      accountsSection += errorAccounts.join("\n");
      if (successAccounts.length > 0) {
        accountsSection += "\n";
      }
    }

    // Put successful accounts in expandable block quotation if there are any
    if (successAccounts.length > 0) {
      accountsSection += `**>Successful Account Updates\n${successAccounts.join("\n")}`;
    }
  }

  return `
${transactionsString(pending, completed)}

Accounts updated:
${accountsSection}

Pending txns:
${transactionList(pending) || "\t😶 None"}
`.trim();
}

function transactionsString(
  pending: Array<Transaction>,
  completed: Array<Transaction>,
) {
  const total = pending.length + completed.length;

  return `
${total} transactions scraped.
${total > 0 ? `(${pending.length} pending, ${completed.length} completed)` : ""}
${foreignTransactionsSummary(completed)}
`.trim();
}

function foreignTransactionsSummary(completed: Array<Transaction>) {
  const original = completed.filter(
    (tx) => normalizeCurrency(tx.originalCurrency) !== "ILS",
  ).length;

  if (original === 0) {
    return "";
  }

  const charged = completed.filter(
    (tx) => normalizeCurrency(tx.chargedCurrency) !== "ILS",
  ).length;
  return `From completed, ${original} not originally in ILS${
    charged ? ` and ${charged} not charged in ILS` : ""
  }`;
}

function transactionAmount(t: Transaction): number {
  switch (t.type) {
    case TransactionTypes.Normal:
      switch (t.status) {
        case TransactionStatuses.Pending:
          return t.originalAmount;
        case TransactionStatuses.Completed:
          return t.chargedAmount;
      }
    case TransactionTypes.Installments:
      return t.chargedAmount;
  }
}

function transactionString(t: Transaction) {
  const amount = transactionAmount(t);

  const sign = amount < 0 ? "-" : "+";
  const absAmount = Math.abs(amount).toFixed(2);

  return `${t?.description}:\t${sign}${absAmount}${
    t.originalCurrency === "ILS" ? "" : ` ${t.originalCurrency}`
  }`;
}

export function transactionList(
  transactions: Array<Transaction>,
  indent = "\t",
) {
  return transactions.map((t) => `${indent}${transactionString(t)}`).join("\n");
}

export function saving(storage: string, steps: Array<Timer> = []) {
  const stepsString = steps.map((s) => `\t${s}`).join("\n");
  return `📝 ${storage} Saving...\n${stepsString}`.trim();
}

function transactionsByStatus(results: Array<AccountScrapeResult>) {
  const allTxns = results
    .flatMap(({ result }) =>
      result.accounts?.flatMap((account) => account?.txns),
    )
    .filter((t): t is Transaction => t !== undefined);

  const pendingTxns = allTxns.filter(
    (t) => t.status === TransactionStatuses.Pending,
  );
  const scrapedTxns = allTxns.filter(
    (t) => t.status === TransactionStatuses.Completed,
  );

  return {
    pending: pendingTxns,
    completed: scrapedTxns,
  };
}
