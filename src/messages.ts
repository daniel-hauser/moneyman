import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions";
import { AccountScrapeResult, SaveStats, Transaction } from "./types";

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
${getPendingSummary(pending) || "\t😶 None"}
    `.trim();
}

function transactionsString(
  pending: Array<Transaction>,
  completed: Array<Transaction>,
) {
  const total = pending.length + completed.length;

  return `${total} transactions scraped ${
    total > 0
      ? `(${pending.length} pending, ${completed.length} completed)`
      : ""
  }`.trim();
}

function getPendingSummary(pending: Array<Transaction>) {
  return pending
    .map((t) => {
      const sign = t.originalAmount < 0 ? "-" : "+";
      const originalAmount = Math.abs(t.originalAmount).toFixed(2);
      const amount =
        t.originalCurrency === "ILS"
          ? originalAmount
          : `${originalAmount} ${t.originalCurrency}`;

      return `\t${t?.description}:\t${sign}${amount}`;
    })
    .join("\n");
}

function statsString(starts: SaveStats): string {
  return `
📝 ${starts.name} (${starts.table})
\t${starts.added} added
\t${starts.skipped} skipped (${starts.existing} existing, ${starts.pending} pending)
  `.trim();
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
