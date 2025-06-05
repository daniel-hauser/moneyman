import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { AccountScrapeResult, Transaction } from "../types.js";
import { normalizeCurrency } from "../utils/currency.js";
import { Timer } from "../utils/Timer.js";
import { MarkdownV2 } from "@telegraf/entity/script/escapers.js";

export function getSummaryMessages(results: Array<AccountScrapeResult>, useMarkdownV2 = false) {
  const { pending, completed } = transactionsByStatus(results);

  let accountsSection = "";
  
  if (useMarkdownV2) {
    // New logic for MarkdownV2 with expandable blocks
    const errorAccounts: string[] = [];
    const successfulAccounts: string[] = [];

    results.forEach(({ result, companyId }) => {
      if (!result.success) {
        const errorMessage = `\t❌ [${companyId}] ${result.errorType}${
          result.errorMessage ? `\n\t\t${result.errorMessage}` : ""
        }`;
        errorAccounts.push(errorMessage);
      } else {
        result.accounts?.forEach((account) => {
          const successMessage = `\t✔️ [${companyId}] ${account.accountNumber}: ${account.txns.length}`;
          successfulAccounts.push(successMessage);
        });
      }
    });
    
    if (errorAccounts.length === 0 && successfulAccounts.length === 0) {
      // No accounts at all
      accountsSection = "Accounts updated:\n\t😶 None";
    } else if (errorAccounts.length === 0) {
      // Only successful accounts - use expandable block without duplication
      const escapedAccounts = successfulAccounts.map(account => MarkdownV2(account)).join("\n");
      accountsSection = `**>Accounts updated**\n${escapedAccounts}`;
    } else if (successfulAccounts.length === 0) {
      // Only error accounts
      accountsSection = `Accounts updated:\n${errorAccounts.join("\n")}`;
    } else {
      // Mixed - show errors first, then successful in expandable block
      const errorSection = `Accounts updated:\n${errorAccounts.join("\n")}`;
      const escapedAccounts = successfulAccounts.map(account => MarkdownV2(account)).join("\n");
      accountsSection = `${errorSection}\n**>Successful Account Updates**\n${escapedAccounts}`;
    }
  } else {
    // Original logic for backward compatibility
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

    accountsSection = `Accounts updated:\n${accountsSummary.join("\n") || "\t😶 None"}`;
  }

  const transactionsSummary = transactionsString(pending, completed, useMarkdownV2);
  const pendingSection = transactionList(pending, "\t", useMarkdownV2) || (useMarkdownV2 ? MarkdownV2("\t😶 None") : "\t😶 None");

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
  useMarkdownV2 = false,
) {
  const total = pending.length + completed.length;

  const summary = `
${total} transactions scraped.
${total > 0 ? `(${pending.length} pending, ${completed.length} completed)` : ""}
${foreignTransactionsSummary(completed)}
`.trim();

  return useMarkdownV2 ? MarkdownV2(summary) : summary;
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
  useMarkdownV2 = false,
) {
  const list = transactions.map((t) => `${indent}${transactionString(t)}`).join("\n");
  return useMarkdownV2 ? MarkdownV2(list) : list;
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
