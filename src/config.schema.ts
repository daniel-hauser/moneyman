import { z } from "zod";

// Account configuration schema based on israeli-bank-scrapers login field combinations
// All accounts require companyId and password as base fields
const BaseAccountSchema = z.object({
  companyId: z.string().min(1, "Company ID is required"),
  password: z.string().min(1, "Password is required"),
});

// Account schema that supports all login field combinations from israeli-bank-scrapers
// Based on the SCRAPERS object which defines loginFields for each company type
export const AccountSchema = BaseAccountSchema.extend({
  // Common fields used across different scrapers
  userCode: z.string().optional(), // hapoalim
  username: z.string().optional(), // leumi, mizrahi, otsarHahayal, max, visaCal, union, beinleumi, massad, yahav, pagi
  id: z.string().optional(), // discount, mercantile, isracard, amex, beyahadBishvilha, behatsdaa
  num: z.string().optional(), // discount, mercantile
  card6Digits: z.string().optional(), // isracard, amex
  nationalID: z.string().optional(), // yahav
  email: z.string().email().optional(), // oneZero
  phoneNumber: z.string().optional(), // oneZero
  otpCodeRetriever: z.string().optional(), // oneZero
  otpLongTermToken: z.string().optional(), // oneZero
}).refine(
  (data) => {
    // Validate that required fields are present based on common patterns
    // This is a flexible schema that allows any combination of the login fields
    // The actual validation of required fields per company type happens at runtime
    return true;
  },
  {
    message:
      "Account configuration must include all required fields for the specified company type",
  },
);

// Storage provider schemas
export const GoogleSheetsSchema = z.object({
  serviceAccountPrivateKey: z.string().min(1, "Google private key is required"),
  serviceAccountEmail: z.string().email("Invalid Google service account email"),
  sheetId: z.string().min(1, "Google Sheet ID is required"),
  worksheetName: z.string().min(1, "Worksheet name is required"),
});

export const YnabSchema = z.object({
  token: z.string().min(1, "YNAB token is required"),
  budgetId: z.string().min(1, "YNAB budget ID is required"),
  accounts: z.record(z.string(), z.string()),
});

export const AzureSchema = z.object({
  appId: z.string().min(1, "Azure app ID is required"),
  appKey: z.string().min(1, "Azure app key is required"),
  tenantId: z.string().min(1, "Azure tenant ID is required"),
  databaseName: z.string().min(1, "Database name is required"),
  tableName: z.string().min(1, "Table name is required"),
  ingestionMapping: z.string().min(1, "Ingestion mapping is required"),
  ingestUri: z.string().url("Invalid ingest URI"),
});

export const BuxferSchema = z.object({
  userName: z.string().min(1, "Buxfer username is required"),
  password: z.string().min(1, "Buxfer password is required"),
  accounts: z.record(z.string(), z.string()),
});

export const ActualSchema = z.object({
  serverUrl: z.string().url("Invalid Actual Budget server URL"),
  password: z.string().min(1, "Actual Budget password is required"),
  budgetId: z.string().min(1, "Actual Budget ID is required"),
  accounts: z.record(z.string(), z.string()),
});

export const WebPostSchema = z.object({
  url: z.string().url("Invalid web post URL"),
  authorizationToken: z.string().min(1, "Authorization token is required"),
});

// Storage configuration schema
export const StorageSchema = z
  .object({
    googleSheets: GoogleSheetsSchema.optional(),
    ynab: YnabSchema.optional(),
    azure: AzureSchema.optional(),
    buxfer: BuxferSchema.optional(),
    actual: ActualSchema.optional(),
    localJson: z.object({ enabled: z.boolean() }).optional(),
    webPost: WebPostSchema.optional(),
  })
  .refine((data) => Object.values(data).some(Boolean), {
    message: "At least one storage provider must be configured",
  });

// Options schemas
export const ScrapingOptionsSchema = z.object({
  accountsToScrape: z.array(z.string()).optional(),
  daysBack: z.number().min(1).max(365).default(10),
  futureMonths: z.number().min(0).max(12).default(1),
  transactionHashType: z.enum(["", "moneyman"]).default(""),
  additionalTransactionInfo: z.boolean().default(false),
  hiddenDeprecations: z.array(z.string()).default([]),
  puppeteerExecutablePath: z.string().optional(),
  maxParallelScrapers: z.number().min(1).max(10).default(1),
  domainTracking: z.boolean().default(false),
});

export const SecurityOptionsSchema = z.object({
  firewallSettings: z.array(z.string()).optional(),
  blockByDefault: z.boolean().default(false),
});

export const NotificationOptionsSchema = z.object({
  telegram: z
    .object({
      apiKey: z.string().min(1, "Telegram API key is required"),
      chatId: z.string().min(1, "Telegram chat ID is required"),
    })
    .optional(),
});

export const LoggingOptionsSchema = z.object({
  getIpInfoUrl: z.string().url().default("https://ipinfo.io/json"),
});

// Complete configuration schema
export const MoneymanConfigSchema = z.object({
  accounts: z.array(AccountSchema).default([]),
  storage: StorageSchema,
  options: z.object({
    scraping: ScrapingOptionsSchema,
    security: SecurityOptionsSchema,
    notifications: NotificationOptionsSchema,
    logging: LoggingOptionsSchema,
  }),
});

export type MoneymanConfig = z.infer<typeof MoneymanConfigSchema>;
