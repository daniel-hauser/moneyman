import { z } from "zod";

// Account configuration schema
export const AccountSchema = z
  .object({
    companyId: z.string().min(1, "Company ID is required"),
    userCode: z.string().optional(),
    username: z.string().optional(),
    password: z.string().min(1, "Password is required"),
  })
  .refine((data) => data.userCode || data.username, {
    message: "Either userCode or username is required",
  });

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
  timezone: z.string().default("Asia/Jerusalem"),
  transactionHashType: z.enum(["", "moneyman"]).default(""),
  additionalTransactionInfo: z.boolean().default(false),
  hiddenDeprecations: z.array(z.string()).default([]),
  puppeteerExecutablePath: z.string().optional(),
  maxParallelScrapers: z.number().min(1).max(10).default(1),
  domainTracking: z.boolean().default(false),
});

export const SecurityOptionsSchema = z.object({
  firewallSettings: z.string().optional(),
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
  debug: z.string().default(""),
  separatedMode: z.boolean().default(true),
  timezone: z.string().default("Asia/Jerusalem"),
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
