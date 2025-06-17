import "dotenv/config";
import { subDays } from "date-fns";
import { z } from "zod";
import { AccountConfig, ScraperConfig } from "./types.js";
import { createLogger } from "./utils/logger.js";

export const systemName = "moneyman";
const logger = createLogger("config");

logger("Parsing config");

// Account configuration schema
const AccountSchema = z.object({
  companyId: z.string().min(1, 'Company ID is required'),
  userCode: z.string().optional(),
  username: z.string().optional(), 
  password: z.string().min(1, 'Password is required'),
}).refine(
  (data) => data.userCode || data.username,
  { message: 'Either userCode or username is required' }
);

// Storage provider schemas
const GoogleSheetsSchema = z.object({
  serviceAccountPrivateKey: z.string().min(1, 'Google private key is required'),
  serviceAccountEmail: z.string().email('Invalid Google service account email'),
  sheetId: z.string().min(1, 'Google Sheet ID is required'),
  worksheetName: z.string().min(1, 'Worksheet name is required'),
});

const YnabSchema = z.object({
  token: z.string().min(1, 'YNAB token is required'),
  budgetId: z.string().min(1, 'YNAB budget ID is required'),
  accounts: z.record(z.string(), z.string()),
});

const AzureSchema = z.object({
  appId: z.string().min(1, 'Azure app ID is required'),
  appKey: z.string().min(1, 'Azure app key is required'),
  tenantId: z.string().min(1, 'Azure tenant ID is required'),
  databaseName: z.string().min(1, 'Database name is required'),
  tableName: z.string().min(1, 'Table name is required'),
  ingestionMapping: z.string().min(1, 'Ingestion mapping is required'),
  ingestUri: z.string().url('Invalid ingest URI'),
});

const BuxferSchema = z.object({
  userName: z.string().min(1, 'Buxfer username is required'),
  password: z.string().min(1, 'Buxfer password is required'),
  accounts: z.record(z.string(), z.string()),
});

const ActualSchema = z.object({
  serverUrl: z.string().url('Invalid Actual Budget server URL'),
  password: z.string().min(1, 'Actual Budget password is required'),
  budgetId: z.string().min(1, 'Actual Budget ID is required'),
  accounts: z.record(z.string(), z.string()),
});

const WebPostSchema = z.object({
  url: z.string().url('Invalid web post URL'),
  authorizationToken: z.string().min(1, 'Authorization token is required'),
});

// Storage configuration schema
const StorageSchema = z.object({
  googleSheets: GoogleSheetsSchema.optional(),
  ynab: YnabSchema.optional(),
  azure: AzureSchema.optional(),
  buxfer: BuxferSchema.optional(),
  actual: ActualSchema.optional(),
  localJson: z.object({ enabled: z.boolean() }).optional(),
  webPost: WebPostSchema.optional(),
}).refine(
  (data) => Object.values(data).some(Boolean),
  { message: 'At least one storage provider must be configured' }
);

// Options schemas
const ScrapingOptionsSchema = z.object({
  accountsToScrape: z.array(z.string()).optional(),
  daysBack: z.number().min(1).max(365).default(10),
  futureMonths: z.number().min(0).max(12).default(1),
  timezone: z.string().default('Asia/Jerusalem'),
  transactionHashType: z.enum(['', 'moneyman']).default(''),
  additionalTransactionInfo: z.boolean().default(false),
  hiddenDeprecations: z.array(z.string()).default([]),
  puppeteerExecutablePath: z.string().optional(),
  maxParallelScrapers: z.number().min(1).max(10).default(1),
  domainTracking: z.boolean().default(false),
});

const SecurityOptionsSchema = z.object({
  firewallSettings: z.string().optional(),
  blockByDefault: z.boolean().default(false),
});

const NotificationOptionsSchema = z.object({
  telegram: z.object({
    apiKey: z.string().min(1, 'Telegram API key is required'),
    chatId: z.string().min(1, 'Telegram chat ID is required'),
  }).optional(),
});

const LoggingOptionsSchema = z.object({
  debug: z.string().default(''),
  separatedMode: z.boolean().default(true),
  timezone: z.string().default('Asia/Jerusalem'),
});

// Complete configuration schema
export const MoneymanConfigSchema = z.object({
  accounts: z.array(AccountSchema).min(1, 'At least one account is required'),
  storage: StorageSchema,
  options: z.object({
    scraping: ScrapingOptionsSchema,
    security: SecurityOptionsSchema,
    notifications: NotificationOptionsSchema,
    logging: LoggingOptionsSchema,
  }),
});

export type MoneymanConfig = z.infer<typeof MoneymanConfigSchema>;

// Environment variable conversion function for backward compatibility
function convertEnvVarsToConfig(): MoneymanConfig {
  const config: MoneymanConfig = {
    accounts: [],
    storage: {},
    options: {
      scraping: {},
      security: {},
      notifications: {},
      logging: {},
    },
  };

  // Convert account configuration
  if (process.env.ACCOUNTS_JSON) {
    try {
      config.accounts = JSON.parse(process.env.ACCOUNTS_JSON);
    } catch (error) {
      throw new Error('Invalid ACCOUNTS_JSON format');
    }
  }

  // Convert scraping options
  if (process.env.ACCOUNTS_TO_SCRAPE) config.options.scraping.accountsToScrape = process.env.ACCOUNTS_TO_SCRAPE.split(',');
  if (process.env.DAYS_BACK) config.options.scraping.daysBack = parseInt(process.env.DAYS_BACK, 10);
  if (process.env.TZ) config.options.scraping.timezone = process.env.TZ;
  if (process.env.FUTURE_MONTHS) config.options.scraping.futureMonths = parseInt(process.env.FUTURE_MONTHS, 10);
  if (process.env.TRANSACTION_HASH_TYPE) config.options.scraping.transactionHashType = process.env.TRANSACTION_HASH_TYPE as '' | 'moneyman';
  if (process.env.ADDITIONAL_TRANSACTION_INFO_ENABLED) config.options.scraping.additionalTransactionInfo = process.env.ADDITIONAL_TRANSACTION_INFO_ENABLED === 'true';
  if (process.env.HIDDEN_DEPRECATIONS) config.options.scraping.hiddenDeprecations = process.env.HIDDEN_DEPRECATIONS.split(',').filter(Boolean);
  if (process.env.PUPPETEER_EXECUTABLE_PATH) config.options.scraping.puppeteerExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.env.MAX_PARALLEL_SCRAPERS) config.options.scraping.maxParallelScrapers = parseInt(process.env.MAX_PARALLEL_SCRAPERS, 10);
  if (process.env.DOMAIN_TRACKING_ENABLED) config.options.scraping.domainTracking = process.env.DOMAIN_TRACKING_ENABLED === 'true';

  // Convert security options
  if (process.env.FIREWALL_SETTINGS) config.options.security.firewallSettings = process.env.FIREWALL_SETTINGS;
  if (process.env.BLOCK_BY_DEFAULT) config.options.security.blockByDefault = process.env.BLOCK_BY_DEFAULT === 'true';

  // Convert Google Sheets storage
  if (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    config.storage.googleSheets = {
      serviceAccountPrivateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
      sheetId: process.env.GOOGLE_SHEET_ID || '',
      worksheetName: process.env.WORKSHEET_NAME || '_moneyman'
    };
  }

  // Convert YNAB storage
  if (process.env.YNAB_TOKEN) {
    config.storage.ynab = {
      token: process.env.YNAB_TOKEN,
      budgetId: process.env.YNAB_BUDGET_ID || '',
      accounts: process.env.YNAB_ACCOUNTS ? JSON.parse(process.env.YNAB_ACCOUNTS) : {}
    };
  }

  // Convert Azure storage
  if (process.env.AZURE_APP_ID) {
    config.storage.azure = {
      appId: process.env.AZURE_APP_ID,
      appKey: process.env.AZURE_APP_KEY || '',
      tenantId: process.env.AZURE_TENANT_ID || '',
      databaseName: process.env.ADE_DATABASE_NAME || '',
      tableName: process.env.ADE_TABLE_NAME || '',
      ingestionMapping: process.env.ADE_INGESTION_MAPPING || '',
      ingestUri: process.env.ADE_INGEST_URI || ''
    };
  }

  // Convert Buxfer storage
  if (process.env.BUXFER_USER_NAME) {
    config.storage.buxfer = {
      userName: process.env.BUXFER_USER_NAME,
      password: process.env.BUXFER_PASSWORD || '',
      accounts: process.env.BUXFER_ACCOUNTS ? JSON.parse(process.env.BUXFER_ACCOUNTS) : {}
    };
  }

  // Convert Actual Budget storage
  if (process.env.ACTUAL_SERVER_URL) {
    config.storage.actual = {
      serverUrl: process.env.ACTUAL_SERVER_URL,
      password: process.env.ACTUAL_PASSWORD || '',
      budgetId: process.env.ACTUAL_BUDGET_ID || '',
      accounts: process.env.ACTUAL_ACCOUNTS ? JSON.parse(process.env.ACTUAL_ACCOUNTS) : {}
    };
  }

  // Convert other storage options
  if (process.env.LOCAL_JSON_STORAGE) config.storage.localJson = { enabled: process.env.LOCAL_JSON_STORAGE === 'true' };
  if (process.env.WEB_POST_URL) {
    config.storage.webPost = {
      url: process.env.WEB_POST_URL,
      authorizationToken: process.env.WEB_POST_AUTHORIZATION_TOKEN || ''
    };
  }

  // Convert notification options
  if (process.env.TELEGRAM_API_KEY) {
    config.options.notifications.telegram = {
      apiKey: process.env.TELEGRAM_API_KEY,
      chatId: process.env.TELEGRAM_CHAT_ID || ''
    };
  }

  // Convert logging options
  if (process.env.DEBUG) config.options.logging.debug = process.env.DEBUG;

  return config;
}

// Parse configuration
let config: MoneymanConfig;
const { MONEYMAN_CONFIG } = process.env;

if (MONEYMAN_CONFIG) {
  logger("Using MONEYMAN_CONFIG");
  try {
    const parsedConfig = JSON.parse(MONEYMAN_CONFIG);
    config = MoneymanConfigSchema.parse(parsedConfig);
  } catch (error) {
    logger("Failed to parse MONEYMAN_CONFIG, falling back to env vars", error);
    config = MoneymanConfigSchema.parse(convertEnvVarsToConfig());
  }
} else {
  logger("Converting individual environment variables to MONEYMAN_CONFIG format...");
  config = MoneymanConfigSchema.parse(convertEnvVarsToConfig());
}

// Export the config for use in other modules
export { config };

// Function to send config to telegram if needed (to be called after imports are resolved)
export async function sendConfigToTelegramIfRequested() {
  const { SEND_NEW_CONFIG_TO_TG } = process.env;
  if (SEND_NEW_CONFIG_TO_TG) {
    try {
      const { sendJSON } = await import("./bot/notifier.js");
      await sendJSON(config, "config.txt");
    } catch (error) {
      logger("Failed to send config to telegram", error);
    }
  }
}

logger("Env", {
  systemName,
  systemTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

logger("config loaded", {
  DAYS_BACK: config.options.scraping.daysBack,
  ACCOUNTS_TO_SCRAPE: config.options.scraping.accountsToScrape,
  FUTURE_MONTHS: config.options.scraping.futureMonths,
  MAX_PARALLEL_SCRAPERS: config.options.scraping.maxParallelScrapers,
  ADDITIONAL_TRANSACTION_INFO_ENABLED: config.options.scraping.additionalTransactionInfo,
});

function getAccounts(): Array<AccountConfig> {
  const allAccounts = config.accounts as Array<AccountConfig>;
  const accountsToScrape = config.options.scraping.accountsToScrape;

  return !accountsToScrape || accountsToScrape.length === 0
    ? allAccounts
    : allAccounts.filter((account) =>
        accountsToScrape.includes(account.companyId),
      );
}

export const scraperConfig: ScraperConfig = {
  accounts: getAccounts(),
  startDate: subDays(Date.now(), config.options.scraping.daysBack),
  parallelScrapers: config.options.scraping.maxParallelScrapers,
  futureMonthsToScrape: config.options.scraping.futureMonths,
  additionalTransactionInformation: config.options.scraping.additionalTransactionInfo,
};
