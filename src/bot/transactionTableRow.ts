import { format, parseISO } from "date-fns";
import { systemName, config } from "../config.js";
import type { TransactionRow } from "../types.js";
import { normalizeCurrency } from "../utils/currency.js";

const currentDate = format(Date.now(), "yyyy-MM-dd");

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
  "raw",
] as const;

export type TableRow = Omit<
  Record<(typeof TableHeaders)[number], string>,
  "amount" | "raw"
> & {
  amount: number;
  raw?: string;
};

export function tableRow(
  tx: TransactionRow,
  includeRaw: boolean = false,
): TableRow {
  const baseRow = {
    date: format(parseISO(tx.date), "dd/MM/yyyy", {}),
    amount: tx.chargedAmount,
    description: tx.description,
    memo: tx.memo ?? "",
    category: tx.category ?? "",
    account: tx.account,
    hash:
      config.options.scraping.transactionHashType === "moneyman"
        ? tx.uniqueId
        : tx.hash,
    comment: "",
    "scraped at": currentDate,
    "scraped by": systemName,
    identifier: `${tx.identifier ?? ""}`,
    // Assuming the transaction is not pending, so we can use the original currency as the charged currency
    chargedCurrency:
      normalizeCurrency(tx.chargedCurrency) ||
      normalizeCurrency(tx.originalCurrency),
  };

  return {
    ...baseRow,
    ...(includeRaw ? { raw: JSON.stringify(tx) } : {}),
  };
}
