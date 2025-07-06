import z from "zod/v4";

// TODO: Use the actual login field combinations from israeli-bank-scrapers once available
// Account configuration schema based on israeli-bank-scrapers login field combinations
const AccountSchema = z.looseObject({
  companyId: z.string().min(1, { error: "Company ID is required" }),
  password: z.string().min(1, { error: "Password is required" }),
});

// Storage provider schemas
export const GoogleSheetsSchema = z.object({
  serviceAccountPrivateKey: z
    .string()
    .min(1, { error: "Google private key is required" }),
  serviceAccountEmail: z.email({
    error: "Invalid Google service account email",
  }),
  sheetId: z.string().min(1, { error: "Google Sheet ID is required" }),
  worksheetName: z.string().min(1, { error: "Worksheet name is required" }),
});

export const YnabSchema = z.object({
  token: z.string().min(1, { error: "YNAB token is required" }),
  budgetId: z.string().min(1, { error: "YNAB budget ID is required" }),
  accounts: z.record(z.string(), z.string()),
});

export const AzureSchema = z.object({
  appId: z.string().min(1, { error: "Azure app ID is required" }),
  appKey: z.string().min(1, { error: "Azure app key is required" }),
  tenantId: z.string().min(1, { error: "Azure tenant ID is required" }),
  databaseName: z.string().min(1, { error: "Database name is required" }),
  tableName: z.string().min(1, { error: "Table name is required" }),
  ingestionMapping: z
    .string()
    .min(1, { error: "Ingestion mapping is required" }),
  ingestUri: z.url({ error: "Invalid ingest URI" }),
});

export const BuxferSchema = z.object({
  userName: z.string().min(1, { error: "Buxfer username is required" }),
  password: z.string().min(1, { error: "Buxfer password is required" }),
  accounts: z.record(z.string(), z.string()),
});

export const ActualSchema = z.object({
  serverUrl: z.url({ error: "Invalid Actual Budget server URL" }),
  password: z.string().min(1, { error: "Actual Budget password is required" }),
  budgetId: z.string().min(1, { error: "Actual Budget ID is required" }),
  accounts: z.record(z.string(), z.string()),
});

export const WebPostSchema = z.object({
  url: z.url({ error: "Invalid web post URL" }),
  authorizationToken: z
    .string()
    .min(1, { error: "Authorization token is required" }),
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
    error: "At least one storage provider must be configured",
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
      apiKey: z.string().min(1, { error: "Telegram API key is required" }),
      chatId: z.string().min(1, { error: "Telegram chat ID is required" }),
    })
    .optional(),
});

export const LoggingOptionsSchema = z.object({
  getIpInfoUrl: z.url().default("https://ipinfo.io/json"),
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
