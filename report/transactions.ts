import type { TransactionView } from "../src/bot/report/transactions.js";
export {
  transactionView,
  type ReportTransaction,
  type TransactionView,
} from "../src/bot/report/transactions.js";
import type { SortKey, Direction } from "../src/bot/report/interactive.js";
export type { SortKey, Direction } from "../src/bot/report/interactive.js";

export function sortTransactions(
  rows: TransactionView[],
  key: SortKey,
  direction: Direction,
) {
  return rows.slice().sort((left, right) => {
    let comparison: number;
    if (key === "account") {
      comparison = left.transaction.accountNumber.localeCompare(
        right.transaction.accountNumber,
        undefined,
        { numeric: true, sensitivity: "base" },
      );
    } else {
      const a = key === "date" ? left.timestamp : (left.amount ?? NaN);
      const b = key === "date" ? right.timestamp : (right.amount ?? NaN);
      if (Number.isNaN(a) !== Number.isNaN(b)) return Number.isNaN(a) ? 1 : -1;
      comparison = Number.isNaN(a) ? 0 : a - b;
    }
    return (
      (direction === "ascending" ? comparison : -comparison) ||
      left.index - right.index
    );
  });
}
