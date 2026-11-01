import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { transaction } from "../src/utils/tests.js";
import { transactionView } from "./transactions.js";
import { renderReportTransactions } from "../src/bot/report/components.js";

it.each([0, 1700000000000, null])(
  "preserves original Date parsing semantics for non-string date %s",
  (value) => {
    const date = JSON.parse(JSON.stringify(value));
    const view = transactionView(
      { ...transaction({ date }), companyId: "max", accountNumber: "123" },
      0,
      new Intl.DateTimeFormat("en-GB", { timeZone: "UTC" }),
    );
    expect(view.timestamp).toBe(new Date(date).getTime());
  },
);

it("renders original dates and canonical amounts/currencies for normal and installment transactions", () => {
  const transactions = [
    transaction({
      date: "2024-01-02T03:04:05.000Z",
      status: TransactionStatuses.Pending,
      originalAmount: 12.34,
      originalCurrency: "$",
      chargedAmount: 999,
      chargedCurrency: "₪",
    }),
    transaction({
      type: TransactionTypes.Installments,
      status: TransactionStatuses.Pending,
      chargedAmount: 50,
      chargedCurrency: "₪",
      originalAmount: 600,
      originalCurrency: "$",
    }),
    transaction({
      chargedAmount: 77,
      chargedCurrency: "€",
      description: '<script> & "original"',
    }),
    transaction({
      chargedAmount: 66,
      chargedCurrency: "",
      originalCurrency: "NIS",
    }),
    transaction({
      status: TransactionStatuses.Pending,
      originalAmount: 11,
      originalCurrency: "gbp",
    }),
    transaction({
      date: 'invalid" onmouseover="alert(1)',
      chargedAmount: 7,
      chargedCurrency: undefined,
      originalCurrency: "eur",
    }),
  ];
  const formatter = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeZone: "UTC",
  });

  expect(
    transactions.map(
      (transaction, index) =>
        transactionView(
          { ...transaction, companyId: "max", accountNumber: "1234" },
          index,
          formatter,
        ).cells,
    ),
  ).toMatchSnapshot();
});

it("coerces untrusted display data to strings without modifying the transaction", () => {
  const value = JSON.parse(
    '{"_$litType$":1,"strings":["<b>untrusted</b>"],"values":[]}',
  );
  const original = {
    ...transaction({ description: value, date: value, status: value }),
    companyId: value,
    accountNumber: value,
  };
  const json = JSON.stringify(original);
  const view = transactionView(original, 0, new Intl.DateTimeFormat("en-GB"));
  expect(view.transaction).toBe(original);
  expect(view.cells.every((cell) => typeof cell === "string")).toBe(true);
  expect([view.cells[0], ...view.cells.slice(2)]).toEqual(
    Array(5).fill("[object Object]"),
  );
  expect(JSON.stringify(original)).toBe(json);
  const output = renderReportTransactions([
    {
      companyId: value,
      result: {
        success: true,
        accounts: [{ accountNumber: value, txns: [original] }],
      },
    },
  ]);
  expect(output).toContain("<report-transactions");
  expect(output).toContain("[object Object]");
  expect(output).toContain("&quot;_$litType$&quot;");
  expect(output).not.toContain("<b>untrusted</b>");
  expect(output).not.toContain("shadowroot");
  expect(JSON.stringify(original)).toBe(json);
});
