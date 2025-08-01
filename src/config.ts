import "dotenv/config";
import { subDays } from "date-fns";
import { Telegraf } from "telegraf";
import { AccountConfig, ScraperConfig } from "./types.js";
import { createLogger } from "./utils/logger.js";
import { parseJsoncConfig } from "./utils/jsonc.js";
import {
  MoneymanConfigSchema,
  type MoneymanConfig,
  ScrapingOptionsSchema,
  SecurityOptionsSchema,
  LoggingOptionsSchema,
  NotificationOptionsSchema,
} from "./config.schema.js";
import { a } from "@mswjs/interceptors/lib/node/BatchInterceptor-5b72232f.js";

export type { MoneymanConfig } from "./config.schema.js";

export const systemName = "moneyman";
const logger = createLogger("config");

logger("Parsing config");
const config: MoneymanConfig = createConfig();
export { config };

// Environment variable conversion function for backward compatibility
function convertEnvVarsToConfig(): MoneymanConfig {
  const config: MoneymanConfig = {
    accounts: [],
    storage: {},
    options: {
      scraping: ScrapingOptionsSchema.parse({}),
      security: SecurityOptionsSchema.parse({}),
      notifications: NotificationOptionsSchema.parse({}),
      logging: LoggingOptionsSchema.parse({}),
    },
  };

  // Convert account configuration
  if (process.env.ACCOUNTS_JSON) {
    try {
      config.accounts = JSON.parse(process.env.ACCOUNTS_JSON);
    } catch (error) {
      throw new Error("Invalid ACCOUNTS_JSON format");
    }
  }

  // Convert scraping options
  if (process.env.ACCOUNTS_TO_SCRAPE)
    config.options.scraping.accountsToScrape =
      process.env.ACCOUNTS_TO_SCRAPE.split(",");
  if (process.env.DAYS_BACK)
    config.options.scraping.daysBack = parseInt(process.env.DAYS_BACK, 10);
  if (process.env.FUTURE_MONTHS)
    config.options.scraping.futureMonths = parseInt(
      process.env.FUTURE_MONTHS,
      10,
    );
  if (process.env.TRANSACTION_HASH_TYPE)
    config.options.scraping.transactionHashType = process.env
      .TRANSACTION_HASH_TYPE as "" | "moneyman";
  if (process.env.ADDITIONAL_TRANSACTION_INFO_ENABLED)
    config.options.scraping.additionalTransactionInfo =
      process.env.ADDITIONAL_TRANSACTION_INFO_ENABLED === "true";
  if (process.env.HIDDEN_DEPRECATIONS)
    config.options.scraping.hiddenDeprecations =
      process.env.HIDDEN_DEPRECATIONS.split(",").filter(Boolean);
  if (typeof process.env.PUPPETEER_EXECUTABLE_PATH)
    config.options.scraping.puppeteerExecutablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.env.MAX_PARALLEL_SCRAPERS)
    config.options.scraping.maxParallelScrapers = parseInt(
      process.env.MAX_PARALLEL_SCRAPERS,
      10,
    );
  if (process.env.DOMAIN_TRACKING_ENABLED)
    config.options.scraping.domainTracking =
      process.env.DOMAIN_TRACKING_ENABLED === "true";

  // Convert security options
  if (process.env.FIREWALL_SETTINGS)
    // TODO: The split by pipe is undocumented, and is here to support one-line env vars with no comment support
    config.options.security.firewallSettings =
      process.env.FIREWALL_SETTINGS.split(/\n|\|/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
  if (process.env.BLOCK_BY_DEFAULT)
    config.options.security.blockByDefault =
      process.env.BLOCK_BY_DEFAULT === "true";

  // Convert Google Sheets storage
  if (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    config.storage.googleSheets = {
      serviceAccountPrivateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
      sheetId: process.env.GOOGLE_SHEET_ID || "",
      worksheetName: process.env.WORKSHEET_NAME || "_moneyman",
    };
  }

  // Convert YNAB storage
  if (process.env.YNAB_TOKEN) {
    config.storage.ynab = {
      token: process.env.YNAB_TOKEN,
      budgetId: process.env.YNAB_BUDGET_ID || "",
      accounts: process.env.YNAB_ACCOUNTS
        ? JSON.parse(process.env.YNAB_ACCOUNTS)
        : {},
    };
  }

  // Convert Azure storage
  if (process.env.AZURE_APP_ID) {
    config.storage.azure = {
      appId: process.env.AZURE_APP_ID,
      appKey: process.env.AZURE_APP_KEY || "",
      tenantId: process.env.AZURE_TENANT_ID || "",
      databaseName: process.env.ADE_DATABASE_NAME || "",
      tableName: process.env.ADE_TABLE_NAME || "",
      ingestionMapping: process.env.ADE_INGESTION_MAPPING || "",
      ingestUri: process.env.ADE_INGEST_URI || "",
    };
  }

  // Convert Buxfer storage
  if (process.env.BUXFER_USER_NAME) {
    config.storage.buxfer = {
      userName: process.env.BUXFER_USER_NAME,
      password: process.env.BUXFER_PASSWORD || "",
      accounts: process.env.BUXFER_ACCOUNTS
        ? JSON.parse(process.env.BUXFER_ACCOUNTS)
        : {},
    };
  }

  // Convert Actual Budget storage
  if (process.env.ACTUAL_SERVER_URL) {
    config.storage.actual = {
      serverUrl: process.env.ACTUAL_SERVER_URL,
      password: process.env.ACTUAL_PASSWORD || "",
      budgetId: process.env.ACTUAL_BUDGET_ID || "",
      accounts: process.env.ACTUAL_ACCOUNTS
        ? JSON.parse(process.env.ACTUAL_ACCOUNTS)
        : {},
    };
  }

  // Convert other storage options
  if (process.env.LOCAL_JSON_STORAGE)
    config.storage.localJson = {
      enabled: process.env.LOCAL_JSON_STORAGE === "true",
    };
  if (process.env.WEB_POST_URL) {
    config.storage.webPost = {
      url: process.env.WEB_POST_URL,
      authorizationToken: process.env.WEB_POST_AUTHORIZATION_TOKEN || "",
    };
  }

  // Convert notification options
  if (process.env.TELEGRAM_API_KEY) {
    config.options.notifications.telegram = {
      apiKey: process.env.TELEGRAM_API_KEY,
      chatId: process.env.TELEGRAM_CHAT_ID || "",
    };
  }

  // Convert logging options
  if (process.env.GET_IP_INFO_URL)
    config.options.logging.getIpInfoUrl = process.env.GET_IP_INFO_URL;

  return config;
}

function createConfig() {
  try {
    const { MONEYMAN_CONFIG } = process.env;
    if (MONEYMAN_CONFIG) {
      logger("Using MONEYMAN_CONFIG");
      try {
        const parsedConfig = parseJsoncConfig(MONEYMAN_CONFIG);
        return MoneymanConfigSchema.parse(parsedConfig);
      } catch (error) {
        logger(
          "Failed to parse MONEYMAN_CONFIG, falling back to env vars",
          error,
        );
        void sendConfigError(error);
        throw new Error("Invalid MONEYMAN_CONFIG format");
      }
    } else {
      try {
        logger("Converting environment variables to MONEYMAN_CONFIG format...");
        return MoneymanConfigSchema.parse(convertEnvVarsToConfig());
      } catch (error) {
        logger("Failed to convert env vars to MONEYMAN_CONFIG", error);
        void sendConfigError(error);
        throw new Error("Invalid environment variables");
      }
    }
  } catch (error) {
    return {
      accounts: [],
      storage: {},
      options: {
        scraping: ScrapingOptionsSchema.parse({}),
        security: SecurityOptionsSchema.parse({}),
        notifications: NotificationOptionsSchema.parse({
          telegram: {
            apiKey: process.env.TELEGRAM_API_KEY || "",
            chatId: process.env.TELEGRAM_CHAT_ID || "",
          },
        }),
        logging: LoggingOptionsSchema.parse({}),
      },
    };
  }
}

// Function to send config to telegram if needed (to be called after imports are resolved)
export async function sendConfigToTelegramIfRequested() {
  if (process.env.SEND_NEW_CONFIG_TO_TG === "true") {
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

logger("config loaded", config.options.scraping);

function getAccounts(): Array<AccountConfig> {
  const allAccounts = config.accounts as Array<AccountConfig>;
  const { accountsToScrape } = config.options.scraping;

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
  additionalTransactionInformation:
    config.options.scraping.additionalTransactionInfo,
};

/**
 * A function to send a telegram message if the config fails to load
 * We can't use the notifier module here because it needs the config to be loaded
 * @param error The error that occurred while loading the config
 */
async function sendConfigError(error: Error): Promise<void> {
  const message = `Failed to load config\n${JSON.stringify(error, null, 2)}`;
  const { TELEGRAM_API_KEY, TELEGRAM_CHAT_ID, MONEYMAN_CONFIG } = process.env;
  if (TELEGRAM_API_KEY && TELEGRAM_CHAT_ID) {
    console.log("sendConfigError using TELEGRAM_API_KEY and TELEGRAM_CHAT_ID");
    await new Telegraf(TELEGRAM_API_KEY).telegram.sendMessage(
      TELEGRAM_CHAT_ID,
      message,
    );
  } else if (MONEYMAN_CONFIG) {
    try {
      console.log("sendConfigError using MONEYMAN_CONFIG");
      const config = parseJsoncConfig(MONEYMAN_CONFIG) as MoneymanConfig;
      if (config.options?.notifications?.telegram) {
        const { apiKey, chatId } = config.options.notifications.telegram;
        await new Telegraf(apiKey).telegram.sendMessage(chatId, message);
      }
    } catch (error) {
      console.error("Failed to send config error to telegram");
    }
  }
}
