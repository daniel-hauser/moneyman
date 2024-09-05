import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { AccountScrapeResult, Transaction } from "./types";
import { normalizeCurrency } from "./utils/currency";

export function getSummaryMessages(results: Array<AccountScrapeResult>) {
  const accountsSummary = results.flatMap(({ result, companyId }) => {
    if (!result.success) {
      return `\t❌ [${companyId}] ${result.errorType}${
        result.errorMessage ? `\n\t\t${result.errorMessage}` : ""
      }`;
    }
    return result.accounts?.map(
      (account) =>
        `\t✔️ [${companyId}] ${account.accountNumber}: ${account.txns.length}`,
    );
  });

  const { pending, completed } = transactionsByStatus(results);

  return `
${transactionsString(pending, completed)}

Accounts updated:
${accountsSummary.join("\n") || "\t😶 None"}

Pending txns:
${transactionList(pending) || "\t😶 None"}
`.trim();
}

function transactionsString(
  pending: Array<Transaction>,
  completed: Array<Transaction>,
) {
  const total = pending.length + completed.length;
  const foreignOriginal = completed.filter(
    (tx) => normalizeCurrency(tx.originalCurrency) !== "ILS",
  );
  const foreignCharged = completed.filter(
    (tx) => normalizeCurrency(tx.chargedCurrency) !== "ILS",
  );

  return `
${total} transactions scraped.
${total > 0 ? `(${pending.length} pending, ${completed.length} completed)` : ""}
${foreignOriginal.length > 0 ? `From completed, ${foreignOriginal.length} not originally in ILS${foreignCharged.length ? ` and ${foreignCharged.length} not charged in ILS` : ""}` : ""}`.trim();
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

export function saving(storage: string) {
  return `📝 ${storage} Saving...`;
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
