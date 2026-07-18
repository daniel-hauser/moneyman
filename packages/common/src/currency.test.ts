import { normalizeCurrency } from "./currency.js";

describe("normalizeCurrency", () => {
  it("should return undefined if currency is undefined", () => {
    const result = normalizeCurrency(undefined);
    expect(result).toBeUndefined();
  });

  it.each([
    ["$", "USD"],
    ["€", "EUR"],
    ["₪", "ILS"],
    ["usd", "USD"],
  ])(
    "should return the normalized currency for %s symbol as %s",
    (currency, expected) => {
      const result = normalizeCurrency(currency);
      expect(result).toBe(expected);
    },
  );

  it("should return the currency as is if it is not a known symbol", () => {
    const result = normalizeCurrency("GBP");
    expect(result).toBe("GBP");
  });

  it("should normalize the currency to uppercase", () => {
    const result = normalizeCurrency("usd");
    expect(result).toBe("USD");
  });
});
