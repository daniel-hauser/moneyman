import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { transaction } from "../src/utils/tests.js";
import { transactionView } from "./transactions.js";

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
