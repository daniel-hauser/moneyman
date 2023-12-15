import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import {
  AccountScrapeResult,
  SaveStats,
  Transaction,
  TransactionRow,
} from "./types";

export function getSummaryMessage(
  results: Array<AccountScrapeResult>,
  stats: Array<SaveStats>,
) {
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

Saved to:
${stats.map((s) => statsString(s)).join("\n") || "\t😶 None"}

-------
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
${
  total > 0 ? `(${pending.length} pending, ${completed.length} completed)` : ""
}`.trim();
}

function transactionString(t: Transaction) {
  const sign = t.originalAmount < 0 ? "-" : "+";
  const originalAmount = Math.abs(t.originalAmount).toFixed(2);
  const amount =
    t.originalCurrency === "ILS"
      ? originalAmount
      : `${originalAmount} ${t.originalCurrency}`;

  return `${t?.description}:\t${sign}${amount}`;
}

function transactionList(transactions: Array<Transaction>, indent = "\t") {
  return transactions.map((t) => `${indent}${transactionString(t)}`).join("\n");
}

function statsString(stats: SaveStats): string {
  return `
📝 ${stats.name} (${stats.table})
\t${stats.added} added
\t${stats.skipped} skipped (${stats.existing} existing, ${
    stats.pending
  } pending)
${highlightedTransactionsString(stats.highlightedTransactions, 1)}`.trim();
}

function transactionsByStatus(results: Array<AccountScrapeResult>) {
  const allTxns = results
    .flatMap(
      ({ result }) => result.accounts?.flatMap((account) => account?.txns),
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

function highlightedTransactionsString(
  groups: Record<string, TransactionRow[]> | undefined,
  indent = 0,
) {
  if (!groups || Object.keys(groups).length === 0) {
    return "";
  }

  const indentString = "\t".repeat(indent);

  return (
    `${indentString}${"-".repeat(5)}\n` +
    `${Object.entries(groups).map(([name, txns]) => {
      const transactionsString = transactionList(txns, `${indentString}\t`);
      return `${indentString}${name}:\n${transactionsString}`;
    })}`
  );
}
