import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { TransactionRow } from "../types.js";
import { transactionList } from "./messages.js";
import { Timer } from "../utils/Timer.js";

export interface SaveStats {
  /**
   * Store name
   */
  name: string;
  /**
   * Store elements to be updated (Accounts, budgets, etc ...)
   */
  table: string | undefined;
  /**
   * Total scrapped transactions handled
   */
  total: number;
  /**
   * Newly added to store
   */
  added: number;
  /**
   * Total scrapped transactions that are pending status
   */
  pending: number;
  /**
   * Transactions that already exists in store and don't required an update
   */
  existing: number;
  /**
   * Transactions skipped for other reasons (missing accounts, ignored by API, etc.)
   */
  otherSkipped: number;
  /**
   * Scrapped transactions that are charged in foreign currency (not ILS)
   */
  highlightedTransactions?: Record<string, Array<TransactionRow>>;
}

/**
 * Calculate the number of skipped transactions (existing + pending + otherSkipped)
 * @param stats SaveStats object
 * @returns Total number of skipped transactions
 */
export function getSkippedCount(stats: SaveStats): number {
  return stats.existing + stats.pending + stats.otherSkipped;
}

/**
 * Create a new SaveStats object with the given name, table and transactions
 * @param name Store name
 * @param table Store elements to be updated (Accounts, budgets, etc ...)
 * @param transactions Scrapped transactions
 * @param stats Optional stats to be added to the new object
 */
export function createSaveStats<TInit extends Partial<SaveStats>>(
  name: string,
  table: string | undefined,
  transactions: Array<TransactionRow>,
  stats: TInit = {} as TInit,
): SaveStats & TInit {
  const total = transactions.length;
  const pending = transactions.filter(
    (tx) => tx.status === TransactionStatuses.Pending,
  ).length;

  return {
    name,
    table,
    total,
    added: 0,
    pending,
    existing: 0,
    otherSkipped: 0,
    ...stats,
  };
}

export function statsString(
  stats: SaveStats,
  saveDurationMs: number,
  steps: Array<Timer> = [],
): string {
  const header = `📝 ${stats.name}${stats.table ? ` (${stats.table})` : ""}`;
  const stepsString = steps.map((s) => `\t${s}`).join("\n");
  const skipped = getSkippedCount(stats);
  return `
${header}${stepsString ? "\n" + stepsString : ""}
\t${stats.added} added${skipped > 0 ? `\t${skipped} skipped (${stats.existing} existing, ${stats.pending} pending)\n` : ""}
\ttook ${(saveDurationMs / 1000).toFixed(2)}s
${highlightedTransactionsString(stats.highlightedTransactions, 1)}`.trim();
}

export function highlightedTransactionsString(
  groups: Record<string, TransactionRow[]> | undefined,
  indent = 0,
) {
  if (!groups || Object.keys(groups).length === 0) {
    return "";
  }

  const indentString = "\t".repeat(indent);
  const groupsString = Object.entries(groups)
    .filter(([_, txns]) => txns.length > 0)
    .map(([name, txns]) => {
      const transactionsString = transactionList(txns, `${indentString}\t`);
      return `${indentString}${name}:\n${transactionsString}`;
    });

  if (groupsString.length === 0) {
    return "";
  }

  return `${indentString}${"-".repeat(5)}\n${groupsString}`;
}
