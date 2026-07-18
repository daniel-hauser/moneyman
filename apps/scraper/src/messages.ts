import {
  TransactionStatuses,
  TransactionTypes,
  TransactionSchema,
  transactionUniqueId,
} from "@moneyman/protocol";
import type { Transaction as ScraperTransaction } from "israeli-bank-scrapers/lib/transactions.js";
import type { AccountScrapeResult } from "./types.js";
import { normalizeCurrency } from "@moneyman/common";
import { escapers } from "@telegraf/entity";

function blockquote(title: string, lines: string[], expandable = true): string {
  const content = lines.join("\n");
  const expandableAttr = expandable ? " expandable" : "";
  return `<blockquote${expandableAttr}>${title}\n${content}</blockquote>`;
}

function getAccountsSummary(results: Array<AccountScrapeResult>): string {
  const successfulAccounts = results
    .filter(({ result }) => result.success)
    .flatMap(({ result, companyId }) =>
      result.accounts?.map(
        (account) =>
          `\t✔️ [${companyId}] ${escapers.HTML(account.accountNumber)}: ${account.txns.length}`,
      ),
    )
    .filter((account): account is string => account !== undefined);

  const errorAccounts = results
    .filter(({ result }) => !result.success)
    .map(
      ({ result, companyId }) =>
        `\t❌ [${companyId}] ${result.errorType}${
          result.errorMessage
            ? `\n\t\t${escapers.HTML(result.errorMessage)}`
            : ""
        }`,
    );

  if (errorAccounts.length === 0 && successfulAccounts.length === 0) {
    // No accounts at all
    return "Accounts updated:\n\t😶 None";
  } else if (errorAccounts.length === 0) {
    // Only successful accounts - use expandable block without duplication
    return blockquote("Accounts updated", successfulAccounts);
  } else if (successfulAccounts.length === 0) {
    // Only error accounts - use expandable block
    return blockquote("Accounts updated", errorAccounts);
  } else {
    // Mixed - show both in separate blocks (applying comment suggestion)
    const failedBlock = blockquote("Failed Account Updates", errorAccounts);
    const successBlock = blockquote(
      "Successful Account Updates",
      successfulAccounts,
    );
    return `${failedBlock}\n\n${successBlock}`;
  }
}

function getPendingTransactionsSummary(pending: ScraperTransaction[]): string {
  if (pending.length === 0) {
    return "";
  } else {
    const pendingContent = transactionList(pending, "\t");
    return blockquote("Pending txns", [pendingContent]);
  }
}

export function getSummaryMessages(results: Array<AccountScrapeResult>) {
  const { pending, completed } = transactionsByStatus(results);

  const sections = [
    transactionsString(pending, completed, results),
    getDuplicateUniqueIdSummary(results),
    getAccountsSummary(results),
    getPendingTransactionsSummary(pending),
  ];
  return sections.filter(Boolean).join("\n\n").trim();
}

function transactionsString(
  pending: ScraperTransaction[],
  completed: ScraperTransaction[],
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

  return escapers.HTML(summary);
}

function foreignTransactionsSummary(completed: ScraperTransaction[]) {
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

function getDuplicateUniqueIdSummary(
  results: Array<AccountScrapeResult>,
): string {
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();

  for (const { result, companyId } of results) {
    if (result.success && result.accounts) {
      for (const account of result.accounts) {
        for (const tx of account.txns) {
          const uniqueId = transactionUniqueId(
            TransactionSchema.parse(tx),
            companyId,
            account.accountNumber,
          );
          if (seen.has(uniqueId)) {
            duplicateIds.add(uniqueId);
          }
          seen.add(uniqueId);
        }
      }
    }
  }

  if (duplicateIds.size === 0) {
    return "";
  }

  const duplicateLines = Array.from(duplicateIds).map(
    (id) => `\t${escapers.HTML(id)}`,
  );

  return blockquote(
    `⚠️ Duplicate uniqueId detected (${duplicateIds.size} unique keys affected)`,
    duplicateLines,
  );
}

function transactionAmount(t: ScraperTransaction): number {
  if (t.type === TransactionTypes.Installments) {
    return t.chargedAmount;
  }
  return t.status === TransactionStatuses.Pending
    ? t.originalAmount
    : t.chargedAmount;
}

function transactionString(t: ScraperTransaction) {
  const amount = transactionAmount(t);

  const sign = amount < 0 ? "-" : "+";
  const absAmount = Math.abs(amount).toFixed(2);

  return `${t?.description}:\t${sign}${absAmount}${
    t.originalCurrency === "ILS" ? "" : ` ${t.originalCurrency}`
  }`;
}

export function transactionList(
  transactions: ScraperTransaction[],
  indent = "\t",
) {
  const list = transactions
    .map((t) => `${indent}${transactionString(t)}`)
    .join("\n");
  return escapers.HTML(list);
}

function transactionsByStatus(results: Array<AccountScrapeResult>) {
  const allTxns = results
    .flatMap(({ result }) =>
      result.accounts?.flatMap((account) => account?.txns),
    )
    .filter((t): t is ScraperTransaction => t !== undefined);

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
