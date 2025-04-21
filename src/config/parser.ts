import { z } from "zod";
import { Config } from "./schema.js";
import { subDays } from "date-fns";
import { createLogger } from "../utils/logger.js";
import { parseStorageConfig } from "./storage.parser.js";

const logger = createLogger("config:parser");

/**
 * Parses the full application configuration from environment variables.
 * First tries to use MONEYMAN_CONFIG as a JSON string.
 * Falls back to legacy environment variables if MONEYMAN_CONFIG isn't set or is invalid.
 */
export function parseConfig(): z.infer<typeof Config> {
  // Try to parse from MONEYMAN_CONFIG first
  const moneymanConfig = process.env.MONEYMAN_CONFIG;
  if (moneymanConfig) {
    try {
      return Config.parse(JSON.parse(moneymanConfig));
    } catch (error) {
      logger("Error parsing MONEYMAN_CONFIG:", error);
    }
  }

  logger("Falling back to legacy environment variables");
  return {
    scraper: parseLegacyScraperConfig(),
    notifier: parseLegacyNotifierConfig(),
    storage: parseStorageConfig(),
  };
}

/**
 * Parse scraper configuration from legacy environment variables.
 */
function parseLegacyScraperConfig() {
  const {
    ACCOUNTS_JSON,
    ACCOUNTS_TO_SCRAPE = "",
    DAYS_BACK,
    FUTURE_MONTHS,
    MAX_PARALLEL_SCRAPERS,
    PUPPETEER_EXECUTABLE_PATH,
    TRANSACTION_HASH_TYPE = "",
    DOMAIN_TRACKING_ENABLED,
    HIDDEN_DEPRECATIONS = "",
    FIREWALL_SETTINGS,
    TZ = "Asia/Jerusalem",
  } = process.env;

  // Parse accounts from ACCOUNTS_JSON
  function parseAccounts(): Array<any> {
    try {
      const parsed = JSON.parse(ACCOUNTS_JSON!);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {}

    throw new TypeError("ACCOUNTS_JSON must be a valid array");
  }

  return {
    accounts: parseAccounts(),
    accountsToScrape: ACCOUNTS_TO_SCRAPE,
    daysBack: DAYS_BACK ? Number(DAYS_BACK) : 10,
    futureMonths: FUTURE_MONTHS ? Number(FUTURE_MONTHS) : 1,
    timezone: TZ,
    maxParallelScrapers: MAX_PARALLEL_SCRAPERS
      ? Number(MAX_PARALLEL_SCRAPERS)
      : 1,
    puppeteerExecutablePath: PUPPETEER_EXECUTABLE_PATH,
    transactionHashType: TRANSACTION_HASH_TYPE as "" | "moneyman",
    domainTrackingEnabled: Boolean(DOMAIN_TRACKING_ENABLED),
    hiddenDeprecations: HIDDEN_DEPRECATIONS
      ? HIDDEN_DEPRECATIONS.split(",")
      : [],
    firewallSettings: FIREWALL_SETTINGS,
  };
}

/**
 * Parse notifier configuration from legacy environment variables.
 */
function parseLegacyNotifierConfig() {
  const { TELEGRAM_TOKEN, TELEGRAM_CHAT_ID } = process.env;

  const config: any = {};

  // Only add telegram config if both required fields are present
  if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
    config.telegram = {
      apiKey: TELEGRAM_TOKEN,
      chatId: TELEGRAM_CHAT_ID,
    };
  }

  return config;
}
