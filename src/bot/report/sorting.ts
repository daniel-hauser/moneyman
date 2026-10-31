import type { TransactionView } from "./transactions.js";

export type SortKey = "date" | "amount" | "account";
export type Direction = "ascending" | "descending";
export type Sorting = { key: SortKey; direction: Direction };

export function sortTransactions(
  rows: TransactionView[],
  key: SortKey,
  direction: Direction,
) {
  return rows.slice().sort((left, right) => {
    let comparison: number;
    if (key === "account") {
      comparison = left.cells[3].localeCompare(right.cells[3], undefined, {
        numeric: true,
        sensitivity: "base",
      });
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
