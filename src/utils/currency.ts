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

const ILS_CURRENCY_LABELS = ["₪", "ILS"];

/**
 * Foreign currencies resolve to ILS when settled after changing from pending status
 * @param tx Transaction checked
 * @returns True if tx resolved in ILS currency
 */
export function checkIlsCharge(tx: TransactionRow): boolean {
  return (
    (tx.chargedCurrency != undefined &&
      ILS_CURRENCY_LABELS.includes(tx.chargedCurrency.trim())) ||
    (tx.originalCurrency != undefined &&
      ILS_CURRENCY_LABELS.includes(tx.originalCurrency.trim()))
  );
}
