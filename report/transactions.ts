import {
  TransactionStatuses,
  TransactionTypes,
  type Transaction,
} from "israeli-bank-scrapers/lib/transactions.js";
import { normalizeCurrency } from "../src/utils/currency.js";

export type ReportTransaction = Transaction & {
  companyId: string;
  accountNumber: string;
};
export type SortKey = "date" | "amount" | "account";
export type Direction = "ascending" | "descending";

export function transactionView(
  transaction: ReportTransaction,
  index: number,
  formatter: Intl.DateTimeFormat,
) {
  const date = new Date(transaction.date);
  const pendingOriginal =
    transaction.type === TransactionTypes.Normal &&
    transaction.status === TransactionStatuses.Pending;
  const amount = pendingOriginal
    ? transaction.originalAmount
    : transaction.chargedAmount;
  const currency =
    (pendingOriginal
      ? normalizeCurrency(transaction.originalCurrency)
      : normalizeCurrency(transaction.chargedCurrency)) ||
    normalizeCurrency(transaction.originalCurrency) ||
    "";
  return {
    transaction,
    index,
    timestamp: date.getTime(),
    amount,
    cells: [
      Number.isNaN(date.getTime()) ? transaction.date : formatter.format(date),
      transaction.companyId,
      transaction.accountNumber,
      transaction.description,
      `${amount.toFixed(2)} ${currency}`,
      transaction.status,
    ],
  };
}

export type TransactionView = ReturnType<typeof transactionView>;

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
      const a = key === "date" ? left.timestamp : left.amount;
      const b = key === "date" ? right.timestamp : right.amount;
      if (Number.isNaN(a) !== Number.isNaN(b)) return Number.isNaN(a) ? 1 : -1;
      comparison = Number.isNaN(a) ? 0 : a - b;
    }
    return (
      (direction === "ascending" ? comparison : -comparison) ||
      left.index - right.index
    );
  });
}
