import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { Transaction } from "../types.js";

export function transaction(t: Partial<Transaction>): Transaction {
  return {
    type: TransactionTypes.Normal,
    date: new Date().toISOString(),
    processedDate: new Date().toISOString(),
    description: "description1",
    originalAmount: 10,
    originalCurrency: "ILS",
    chargedCurrency: "ILS",
    chargedAmount: t.status === TransactionStatuses.Pending ? 0 : 10,
    status: TransactionStatuses.Completed,
    ...t,
  };
}
