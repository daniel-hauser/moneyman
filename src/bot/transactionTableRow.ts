import { format, parseISO } from "date-fns";
import { systemName } from "../config.js";
import type { TransactionRow } from "../types.js";
import { normalizeCurrency } from "../utils/currency.js";

const currentDate = format(Date.now(), "yyyy-MM-dd");
const { TRANSACTION_HASH_TYPE } = process.env;

export const TableHeaders = [
  "date",
  "amount",
  "description",
  "memo",
  "category",
  "account",
  "hash",
  "comment",
  "scraped at",
  "scraped by",
  "identifier",
  "chargedCurrency",
] as const;

export type TableRow = Omit<
  Record<(typeof TableHeaders)[number], string>,
  "amount"
> & {
  amount: number;
};

export function tableRow(tx: TransactionRow): TableRow {
  return {
    date: format(parseISO(tx.date), "dd/MM/yyyy", {}),
    amount: tx.chargedAmount,
    description: tx.description,
    memo: tx.memo ?? "",
    category: tx.category ?? "",
    account: tx.account,
    hash: TRANSACTION_HASH_TYPE === "moneyman" ? tx.uniqueId : tx.hash,
    comment: "",
    "scraped at": currentDate,
    "scraped by": systemName,
    identifier: `${tx.identifier ?? ""}`,
    // Assuming the transaction is not pending, so we can use the original currency as the charged currency
    chargedCurrency:
      normalizeCurrency(tx.chargedCurrency) ||
      normalizeCurrency(tx.originalCurrency),
  };
}
