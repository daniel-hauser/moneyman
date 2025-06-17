import "dotenv/config";
import { subDays } from "date-fns";
import { z } from "zod";
import { AccountConfig, ScraperConfig } from "./types.js";
import { createLogger } from "./utils/logger.js";

export const systemName = "moneyman";
const logger = createLogger("config");

logger("Parsing config");

// Define config schema using zod
const configSchema = z.object({
  // Core scraper configuration
  DAYS_BACK: z.string().optional().default("10"),
  ACCOUNTS_TO_SCRAPE: z.string().optional().default(""),
  FUTURE_MONTHS: z.string().optional().default(""),
  MAX_PARALLEL_SCRAPERS: z.string().optional().default(""),
  ADDITIONAL_TRANSACTION_INFO_ENABLED: z.string().optional().default("false"),
  ACCOUNTS_JSON: z.string().optional().default(""),

  // Telegram
  TELEGRAM_API_KEY: z.string().optional().default(""),
  TELEGRAM_CHAT_ID: z.string().optional().default(""),

  // Google Sheets
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional().default(""),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional().default(""),
  GOOGLE_SHEET_ID: z.string().optional().default(""),
  WORKSHEET_NAME: z.string().optional().default(""),

  // Azure Data Explorer
  AZURE_APP_ID: z.string().optional().default(""),
  AZURE_APP_KEY: z.string().optional().default(""),
  AZURE_TENANT_ID: z.string().optional().default(""),
  ADE_DATABASE_NAME: z.string().optional().default(""),
  ADE_TABLE_NAME: z.string().optional().default(""),
  ADE_INGESTION_MAPPING: z.string().optional().default(""),
  ADE_INGEST_URI: z.string().optional().default(""),

  // YNAB
  YNAB_TOKEN: z.string().optional().default(""),
  YNAB_BUDGET_ID: z.string().optional().default(""),
  YNAB_ACCOUNTS: z.string().optional().default(""),

  // Buxfer
  BUXFER_USER_NAME: z.string().optional().default(""),
  BUXFER_PASSWORD: z.string().optional().default(""),
  BUXFER_ACCOUNTS: z.string().optional().default(""),

  // Actual Budget
  ACTUAL_SERVER_URL: z.string().optional().default(""),
  ACTUAL_PASSWORD: z.string().optional().default(""),
  ACTUAL_BUDGET_ID: z.string().optional().default(""),
  ACTUAL_ACCOUNTS: z.string().optional().default(""),

  // Web Post
  WEB_POST_URL: z.string().optional().default(""),
  WEB_POST_AUTHORIZATION_TOKEN: z.string().optional().default(""),

  // Other storage/features
  LOCAL_JSON_STORAGE: z.string().optional().default(""),
  TRANSACTION_HASH_TYPE: z.string().optional().default(""),
  HIDDEN_DEPRECATIONS: z.string().optional().default(""),

  // Security/Domain
  DOMAIN_TRACKING_ENABLED: z.string().optional().default(""),
  FIREWALL_SETTINGS: z.string().optional().default(""),
  BLOCK_BY_DEFAULT: z.string().optional().default(""),

  // Browser/Scraper
  PUPPETEER_EXECUTABLE_PATH: z.string().optional().default(""),

  // Network
  GET_IP_INFO_URL: z.string().optional().default(""),
});

type Config = z.infer<typeof configSchema>;

// Parse configuration
let config: Config;
const { MONEYMAN_CONFIG } = process.env;

if (MONEYMAN_CONFIG) {
  logger("Using MONEYMAN_CONFIG");
  try {
    const parsedConfig = JSON.parse(MONEYMAN_CONFIG);
    config = configSchema.parse(parsedConfig);
  } catch (error) {
    logger("Failed to parse MONEYMAN_CONFIG, falling back to env vars", error);
    config = configSchema.parse(process.env);
  }
} else {
  logger("Using environment variables");
  config = configSchema.parse(process.env);
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
  DAYS_BACK: config.DAYS_BACK,
  ACCOUNTS_TO_SCRAPE: config.ACCOUNTS_TO_SCRAPE,
  FUTURE_MONTHS: config.FUTURE_MONTHS,
  MAX_PARALLEL_SCRAPERS: config.MAX_PARALLEL_SCRAPERS,
  ADDITIONAL_TRANSACTION_INFO_ENABLED:
    config.ADDITIONAL_TRANSACTION_INFO_ENABLED,
});

function getAccounts(): Array<AccountConfig> {
  function parseAccounts(accountsJson?: string): Array<AccountConfig> {
    if (!accountsJson) {
      return [];
    }
    try {
      const parsed = JSON.parse(accountsJson);
      if (Array.isArray(parsed)) {
        // TODO: Add schema validations?
        return parsed as Array<AccountConfig>;
      }
    } catch {}

    throw new TypeError("ACCOUNTS_JSON must be a valid array");
  }

  const allAccounts = parseAccounts(config.ACCOUNTS_JSON);
  const accountsToScrape = config.ACCOUNTS_TO_SCRAPE.split(",")
    .filter(Boolean)
    .map((a) => a.trim());

  return accountsToScrape.length == 0
    ? allAccounts
    : allAccounts.filter((account) =>
        accountsToScrape.includes(account.companyId),
      );
}

export const scraperConfig: ScraperConfig = {
  accounts: getAccounts(),
  startDate: subDays(Date.now(), Number(config.DAYS_BACK || 10)),
  parallelScrapers: Number(config.MAX_PARALLEL_SCRAPERS) || 1,
  futureMonthsToScrape: parseInt(config.FUTURE_MONTHS, 10),
  additionalTransactionInformation:
    config.ADDITIONAL_TRANSACTION_INFO_ENABLED.toLowerCase() === "true",
};
