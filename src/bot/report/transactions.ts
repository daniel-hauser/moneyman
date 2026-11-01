import {
  TransactionStatuses,
  TransactionTypes,
  type Transaction,
} from "israeli-bank-scrapers/lib/transactions.js";
import { normalizeCurrency } from "../../utils/currency.js";

export type ReportTransaction = Transaction & {
  companyId: string;
  accountNumber: string;
};

export function transactionView(
  transaction: ReportTransaction,
  index: number,
  formatter: Intl.DateTimeFormat,
) {
  const displayDate = String(transaction.date);
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
      Number.isNaN(date.getTime()) ? displayDate : formatter.format(date),
      `${amount?.toFixed(2) ?? "NaN"} ${currency}`.trim(),
      String(transaction.description),
      String(transaction.accountNumber),
      String(transaction.companyId),
      String(transaction.status),
    ],
  };
}

export type TransactionView = ReturnType<typeof transactionView>;
