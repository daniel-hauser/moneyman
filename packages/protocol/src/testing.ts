import {
  TransactionStatuses,
  TransactionTypes,
  type Transaction,
  type TransactionRow,
} from "./types.js";
import {
  ExporterAppConfigSchema,
  type ExporterAppConfig,
} from "./config.schema.js";

export function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    type: TransactionTypes.Normal,
    date: new Date("2026-01-30").toISOString(),
    processedDate: new Date("2026-01-30").toISOString(),
    description: "description1",
    originalAmount: 10,
    originalCurrency: "ILS",
    chargedCurrency: "ILS",
    chargedAmount: overrides.status === TransactionStatuses.Pending ? 0 : 10,
    status: TransactionStatuses.Completed,
    ...overrides,
  };
}

export function transactionRow(
  overrides: Partial<TransactionRow> = {},
): TransactionRow {
  return {
    account: "1234",
    hash: "hash-1",
    uniqueId: "unique-1",
    companyId: "hapoalim",
    ...transaction(overrides),
    ...overrides,
  };
}

export function config(): ExporterAppConfig {
  return ExporterAppConfigSchema.parse({
    storage: { localJson: { enabled: true } },
    options: {
      scraping: {
        transactionHashType: "moneyman",
        hiddenDeprecations: [],
      },
    },
  });
}
