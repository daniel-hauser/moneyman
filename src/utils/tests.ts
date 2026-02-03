import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { Transaction, TransactionRow } from "../types.js";
import {
  LoggingOptionsSchema,
  MoneymanConfig,
  NotificationOptionsSchema,
  ScrapingOptionsSchema,
  SecurityOptionsSchema,
} from "../config.schema.js";
import { CompanyTypes } from "israeli-bank-scrapers";

export function transaction(t: Partial<Transaction>): Transaction {
  return {
    type: TransactionTypes.Normal,
    date: new Date("2026-01-30").toISOString(),
    processedDate: new Date("2026-01-30").toISOString(),
    description: "description1",
    originalAmount: 10,
    originalCurrency: "ILS",
    chargedCurrency: "ILS",
    chargedAmount: t.status === TransactionStatuses.Pending ? 0 : 10,
    status: TransactionStatuses.Completed,
    ...t,
  };
}

export function transactionRow(tx: Partial<TransactionRow>): TransactionRow {
  return {
    account: "1234",
    hash: "hash-1",
    uniqueId: "unique-1",
    companyId: CompanyTypes.hapoalim,
    ...transaction(tx),
    ...tx,
  };
}

export function config(): MoneymanConfig {
  return {
    accounts: [],
    storage: {},
    options: {
      scraping: ScrapingOptionsSchema.parse({
        transactionHashType: "moneyman",
      }),
      security: SecurityOptionsSchema.parse({}),
      notifications: NotificationOptionsSchema.parse({}),
      logging: LoggingOptionsSchema.parse({}),
    },
  };
}
