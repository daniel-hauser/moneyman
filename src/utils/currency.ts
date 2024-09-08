import { TransactionRow } from "../types.js";

const symbolToCurrency = {
  $: "USD",
  "€": "EUR",
  "₪": "ILS",
};

export function normalizeCurrency(currency: string | undefined) {
  if (!currency) return undefined;
  return (symbolToCurrency[currency] ?? currency).toUpperCase();
}

/**
 * Foreign currencies resolve to ILS when settled after changing from pending status
 * @param tx Transaction checked
 * @returns True if tx resolved in ILS currency
 */
export function isIlsTransaction(tx: TransactionRow): boolean {
  return (
    normalizeCurrency(tx.chargedCurrency) === "ILS" ||
    normalizeCurrency(tx.originalCurrency) === "ILS"
  );
}
