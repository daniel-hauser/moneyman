const symbolToCurrency = {
  $: "USD",
  "€": "EUR",
  "₪": "ILS",
  NIS: "ILS",
};

export function normalizeCurrency(currency: string | undefined) {
  if (!currency) return undefined;
  return (symbolToCurrency[currency] ?? currency).toUpperCase();
}
