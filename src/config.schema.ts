import { z } from "zod";

// Account configuration schema based on israeli-bank-scrapers login field combinations
const BaseAccountSchema = z.object({
  companyId: z.string().min(1, "Company ID is required"),
  password: z.string().min(1, "Password is required"),
});

// Define specific account types based on login field combinations from israeli-bank-scrapers
const HapoalimAccountSchema = BaseAccountSchema.extend({
  userCode: z.string().min(1, "User code is required"),
});

const StandardUsernameAccountSchema = BaseAccountSchema.extend({
  username: z.string().min(1, "Username is required"),
});

const DiscountMercantileAccountSchema = BaseAccountSchema.extend({
  id: z.string().min(1, "ID is required"),
  num: z.string().min(1, "Number is required"),
});

const IsracardAmexAccountSchema = BaseAccountSchema.extend({
  id: z.string().min(1, "ID is required"),
  card6Digits: z.string().min(1, "Card 6 digits is required"),
});

const YahavAccountSchema = BaseAccountSchema.extend({
  username: z.string().min(1, "Username is required"),
  nationalID: z.string().min(1, "National ID is required"),
});

const BeyahadBehatsdaaAccountSchema = BaseAccountSchema.extend({
  id: z.string().min(1, "ID is required"),
});

const OneZeroAccountSchema = BaseAccountSchema.extend({
  email: z.string().email("Valid email is required"),
  phoneNumber: z.string().min(1, "Phone number is required"),
  otpCodeRetriever: z.string().optional(),
  otpLongTermToken: z.string().optional(),
});

// Union of all possible account configurations
export const AccountSchema = z.union([
  HapoalimAccountSchema,
  StandardUsernameAccountSchema,
  DiscountMercantileAccountSchema,
  IsracardAmexAccountSchema,
  YahavAccountSchema,
  BeyahadBehatsdaaAccountSchema,
  OneZeroAccountSchema,
]);

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
  accounts: z.array(AccountSchema).min(1, "At least one account is required"),
  storage: StorageSchema,
  options: z.object({
    scraping: ScrapingOptionsSchema,
    security: SecurityOptionsSchema,
    notifications: NotificationOptionsSchema,
    logging: LoggingOptionsSchema,
  }),
});

export type MoneymanConfig = z.infer<typeof MoneymanConfigSchema>;
