export function normalizeCurrency(currency: string | undefined) {
  const symbolToCurrency: Record<string, string> = {
    $: "USD",
    "€": "EUR",
    "₪": "ILS",
    NIS: "ILS",
  };
  if (!currency) return undefined;
  return (symbolToCurrency[currency] ?? currency).toUpperCase();
}
