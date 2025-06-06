import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { AccountScrapeResult, Transaction } from "../types.js";
import { normalizeCurrency } from "../utils/currency.js";
import { Timer } from "../utils/Timer.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getAccountsSummary(results: Array<AccountScrapeResult>): string {
  const successfulAccounts: string[] = [];
  const errorAccounts: string[] = [];

  results.forEach(({ result, companyId }) => {
    if (!result.success) {
      const errorMessage = `\t❌ [${companyId}] ${result.errorType}${
        result.errorMessage ? `\n\t\t${escapeHtml(result.errorMessage)}` : ""
      }`;
      errorAccounts.push(errorMessage);
    } else {
      result.accounts?.forEach((account) => {
        const successMessage = `\t✔️ [${companyId}] ${escapeHtml(account.accountNumber)}: ${account.txns.length}`;
        successfulAccounts.push(successMessage);
      });
    }
  });

  if (errorAccounts.length === 0 && successfulAccounts.length === 0) {
    // No accounts at all
    return "Accounts updated:\n\t😶 None";
  } else if (errorAccounts.length === 0) {
    // Only successful accounts - use expandable block without duplication
    const accountsContent = successfulAccounts.join("\n");
    return `<blockquote expandable="">Accounts updated\n${accountsContent}</blockquote>`;
  } else if (successfulAccounts.length === 0) {
    // Only error accounts
    return `Accounts updated:\n${errorAccounts.join("\n")}`;
  } else {
    // Mixed - show errors first, then successful in expandable block
    const errorSection = `Accounts updated:\n${errorAccounts.join("\n")}`;
    const accountsContent = successfulAccounts.join("\n");
    return `${errorSection}\n<blockquote expandable="">Successful Account Updates\n${accountsContent}</blockquote>`;
  }
}

export function getSummaryMessages(results: Array<AccountScrapeResult>) {
  const { pending, completed } = transactionsByStatus(results);

  const accountsSection = getAccountsSummary(results);

  const transactionsSummary = transactionsString(pending, completed, results);
  const pendingSection =
    transactionList(pending, "\t") || escapeHtml("\t😶 None");

  return `
${transactionsSummary}

${accountsSection}

Pending txns:
${pendingSection}
`.trim();
}

function transactionsString(
  pending: Array<Transaction>,
  completed: Array<Transaction>,
  results: Array<AccountScrapeResult>,
) {
  const total = pending.length + completed.length;

  // Count total accounts from successful results
  const totalAccounts = results.reduce((count, { result }) => {
    if (result.success) {
      return count + (result.accounts?.length || 0);
    }
    return count;
  }, 0);

  const accountText =
    totalAccounts > 0
      ? ` from ${totalAccounts} account${totalAccounts === 1 ? "" : "s"}`
      : "";

  const summary = `
${total} transactions scraped${accountText}.
${total > 0 ? `(${pending.length} pending, ${completed.length} completed)` : ""}
${foreignTransactionsSummary(completed)}
`.trim();

  return escapeHtml(summary);
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
  const list = transactions
    .map((t) => `${indent}${transactionString(t)}`)
    .join("\n");
  return escapeHtml(list);
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
