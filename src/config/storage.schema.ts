import { z } from "zod";

// Storage configuration schemas
export const LocalJsonConfig = z.object({
  enabled: z
    .boolean()
    .default(true)
    .describe("Whether to save transactions to a local JSON file"),
});

export const GoogleSheetsConfig = z.object({
  sheetId: z
    .string()
    .describe("Google Sheet ID where transactions will be stored"),
  serviceAccountEmail: z
    .string()
    .describe("Google Service Account email for authentication"),
  serviceAccountPrivateKey: z
    .string()
    .describe("Google Service Account private key for authentication"),
  worksheetName: z
    .string()
    .default("_moneyman")
    .describe("Name of the worksheet in Google Sheets"),
});

export const YnabConfig = z.object({
  token: z.string().describe("YNAB access token for authentication"),
  budgetId: z
    .string()
    .describe("YNAB budget ID where transactions will be imported"),
  accounts: z
    .record(z.string(), z.string())
    .describe("Mapping of account identifiers to YNAB account UUIDs"),
});

export const BuxferConfig = z.object({
  username: z.string().describe("Buxfer user name for authentication"),
  password: z.string().describe("Buxfer user password for authentication"),
  accounts: z
    .record(z.string(), z.string())
    .describe("Mapping of account identifiers to Buxfer account UUIDs"),
});

export const WebPostConfig = z.object({
  url: z.string().describe("URL to post transactions to"),
  authorizationToken: z
    .string()
    .optional()
    .describe("Authorization header value for web post requests"),
});

export const AzureDataExplorerConfig = z.object({
  appId: z.string().describe("Azure application ID for authentication"),
  appKey: z
    .string()
    .describe("Azure application secret key for authentication"),
  tenantId: z.string().describe("Tenant ID of your Azure application"),
  databaseName: z.string().describe("Azure Data Explorer database name"),
  tableName: z.string().describe("Azure Data Explorer table name"),
  ingestionMapping: z
    .string()
    .describe("Name of the JSON ingestion mapping in Azure Data Explorer"),
  ingestUri: z
    .string()
    .describe("Ingest URI of the Azure Data Explorer cluster"),
});

export const TelegramStorageConfig = z.object({
  chatId: z.string().describe("Telegram chat ID to send transactions to"),
});

export const StorageConfig = z.object({
  localJson: LocalJsonConfig.optional(),
  googleSheets: GoogleSheetsConfig.optional(),
  ynab: YnabConfig.optional(),
  buxfer: BuxferConfig.optional(),
  webPost: WebPostConfig.optional(),
  azureDataExplorer: AzureDataExplorerConfig.optional(),
  telegram: TelegramStorageConfig.optional(),
});
