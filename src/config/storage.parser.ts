import { z } from "zod";
import {
  StorageConfig,
  LocalJsonConfig,
  GoogleSheetsConfig,
  YnabConfig,
  BuxferConfig,
  WebPostConfig,
  AzureDataExplorerConfig,
  TelegramStorageConfig,
} from "./storage.schema.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("config:storage-parser");

/**
 * Parses storage configuration from environment variables.
 * First tries to use MONEYMAN_CONFIG as a JSON string.
 * Falls back to legacy environment variables if MONEYMAN_CONFIG isn't set.
 */
export function parseStorageConfig(): z.infer<typeof StorageConfig> {
  const config: z.infer<typeof StorageConfig> = {
    localJson: parseLocalJsonConfig(),
    googleSheets: parseGoogleSheetsConfig(),
    ynab: parseYnabConfig(),
    buxfer: parseBuxferConfig(),
    webPost: parseWebPostConfig(),
    azureDataExplorer: parseAzureDataExplorerConfig(),
    telegram: parseTelegramStorageConfig(),
  };

  return Object.fromEntries(
    Object.entries(config).filter(([_, value]) => value !== undefined),
  ) as z.infer<typeof StorageConfig>;
}

/**
 * Parse LocalJsonConfig from environment variables.
 */
function parseLocalJsonConfig(): z.infer<typeof LocalJsonConfig> | undefined {
  const { LOCAL_JSON_STORAGE } = process.env;

  // If the flag isn't set, don't configure this storage
  if (!LOCAL_JSON_STORAGE) {
    return undefined;
  }

  return LocalJsonConfig.parse({
    enabled: LOCAL_JSON_STORAGE,
  });
}

/**
 * Parse GoogleSheetsConfig from environment variables.
 */
function parseGoogleSheetsConfig():
  | z.infer<typeof GoogleSheetsConfig>
  | undefined {
  const {
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_SHEET_ID,
    GOOGLE_WORKSHEET_NAME,
  } = process.env;

  // If any required fields are missing, don't configure this storage
  if (
    !GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    !GOOGLE_SHEET_ID
  ) {
    return undefined;
  }

  try {
    return GoogleSheetsConfig.parse({
      serviceAccountEmail: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      serviceAccountPrivateKey: GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      sheetId: GOOGLE_SHEET_ID,
      worksheetName: GOOGLE_WORKSHEET_NAME,
    });
  } catch (error) {
    logger("Error parsing GoogleSheetsConfig:", error);
    return undefined;
  }
}

/**
 * Parse YnabConfig from environment variables.
 */
function parseYnabConfig(): z.infer<typeof YnabConfig> | undefined {
  const { YNAB_TOKEN, YNAB_BUDGET_ID, YNAB_ACCOUNTS } = process.env;

  // If any required fields are missing, don't configure this storage
  if (!YNAB_TOKEN || !YNAB_BUDGET_ID || !YNAB_ACCOUNTS) {
    return undefined;
  }

  try {
    return YnabConfig.parse({
      token: YNAB_TOKEN,
      budgetId: YNAB_BUDGET_ID,
      accounts: JSON.parse(YNAB_ACCOUNTS),
    });
  } catch (error) {
    logger("Error parsing YnabConfig:", error);
    return undefined;
  }
}

/**
 * Parse BuxferConfig from environment variables.
 */
function parseBuxferConfig(): z.infer<typeof BuxferConfig> | undefined {
  const { BUXFER_USER_NAME, BUXFER_PASSWORD, BUXFER_ACCOUNTS } = process.env;

  // If any required fields are missing, don't configure this storage
  if (!BUXFER_USER_NAME || !BUXFER_PASSWORD || !BUXFER_ACCOUNTS) {
    return undefined;
  }

  try {
    return BuxferConfig.parse({
      username: BUXFER_USER_NAME,
      password: BUXFER_PASSWORD,
      accounts: JSON.parse(BUXFER_ACCOUNTS),
    });
  } catch (error) {
    logger("Error parsing BuxferConfig:", error);
    return undefined;
  }
}

/**
 * Parse WebPostConfig from environment variables.
 */
function parseWebPostConfig(): z.infer<typeof WebPostConfig> | undefined {
  const { WEB_POST_URL, WEB_POST_AUTHORIZATION_TOKEN } = process.env;

  // If the URL is missing, don't configure this storage
  if (!WEB_POST_URL) {
    return undefined;
  }

  try {
    return WebPostConfig.parse({
      url: WEB_POST_URL,
      authorizationToken: WEB_POST_AUTHORIZATION_TOKEN,
    });
  } catch (error) {
    logger("Error parsing WebPostConfig:", error);
    return undefined;
  }
}

/**
 * Parse AzureDataExplorerConfig from environment variables.
 */
function parseAzureDataExplorerConfig():
  | z.infer<typeof AzureDataExplorerConfig>
  | undefined {
  const {
    AZURE_APP_ID,
    AZURE_APP_KEY,
    AZURE_TENANT_ID,
    ADE_DATABASE_NAME,
    ADE_TABLE_NAME,
    ADE_INGESTION_MAPPING,
    ADE_INGEST_URI,
  } = process.env;

  // If any required fields are missing, don't configure this storage
  if (
    !AZURE_APP_ID ||
    !AZURE_APP_KEY ||
    !AZURE_TENANT_ID ||
    !ADE_DATABASE_NAME ||
    !ADE_TABLE_NAME ||
    !ADE_INGESTION_MAPPING ||
    !ADE_INGEST_URI
  ) {
    return undefined;
  }

  try {
    return AzureDataExplorerConfig.parse({
      appId: AZURE_APP_ID,
      appKey: AZURE_APP_KEY,
      tenantId: AZURE_TENANT_ID,
      databaseName: ADE_DATABASE_NAME,
      tableName: ADE_TABLE_NAME,
      ingestionMapping: ADE_INGESTION_MAPPING,
      ingestUri: ADE_INGEST_URI,
    });
  } catch (error) {
    logger("Error parsing AzureDataExplorerConfig:", error);
    return undefined;
  }
}

/**
 * Parse TelegramStorageConfig from environment variables.
 */
function parseTelegramStorageConfig():
  | z.infer<typeof TelegramStorageConfig>
  | undefined {
  const { TELEGRAM_CHAT_ID } = process.env;

  // If the chat ID is missing, don't configure this storage
  if (!TELEGRAM_CHAT_ID) {
    return undefined;
  }

  try {
    return TelegramStorageConfig.parse({
      chatId: TELEGRAM_CHAT_ID,
    });
  } catch (error) {
    logger("Error parsing TelegramStorageConfig:", error);
    return undefined;
  }
}
