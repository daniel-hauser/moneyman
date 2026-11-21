import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import { AccountScrapeResult, Transaction, TransactionRow } from "../types.js";
import {
  LoggingOptionsSchema,
  MoneymanConfig,
  NotificationOptionsSchema,
  ScrapingOptionsSchema,
  SchedulingOptionsSchema,
  SecurityOptionsSchema,
} from "../config.schema.js";
import { CompanyTypes } from "israeli-bank-scrapers";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";

export function labeledScrapeResults(): AccountScrapeResult[] {
  return [
    {
      companyId: CompanyTypes.hapoalim,
      scrapedAt: "2026-01-30T12:00:00.000Z",
      scrapeId: "home-bank",
      result: {
        success: true,
        accounts: [{ accountNumber: "sample-account", txns: [] }],
      },
    },
    {
      companyId: CompanyTypes.visaCal,
      scrapedAt: "2026-01-30T12:00:00.000Z",
      scrapeId: "shared-card",
      result: { success: true, accounts: [] },
    },
    {
      companyId: CompanyTypes.max,
      scrapedAt: "2026-01-30T12:00:00.000Z",
      result: { success: true },
    },
    ...[
      {
        companyId: CompanyTypes.hapoalim,
        scrapeId: '  <b>חשבון בית 🏡</b> "&"  ',
      },
      {
        companyId: CompanyTypes.hapoalim,
        scrapeId: '  <b>חשבון בית 🏡</b> "&"  ',
      },
      {
        companyId: CompanyTypes.visaCal,
        scrapeId: '  <b>חשבון בית 🏡</b> "&"  ',
      },
      { companyId: CompanyTypes.max },
      { companyId: CompanyTypes.max },
    ].map((login) => ({
      ...login,
      scrapedAt: "2026-01-30T12:00:00.000Z",
      result: {
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: "Invented <failure>",
      },
    })),
  ];
}

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
    scrapedAt: "2026-01-30T12:00:00.000Z",
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
      scheduling: SchedulingOptionsSchema.parse({}),
    },
  };
}
