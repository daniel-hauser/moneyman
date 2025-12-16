import "dotenv/config";
import { subDays } from "date-fns";
import { Telegraf } from "telegraf";
import { readFileSync } from "fs";
import { AccountConfig, ScraperConfig } from "./types.js";
import { createLogger, logToPublicLog } from "./utils/logger.js";
import { parseJsoncConfig } from "./utils/jsonc.js";
import {
  MoneymanConfigSchema,
  type MoneymanConfig,
  ScrapingOptionsSchema,
  SecurityOptionsSchema,
  LoggingOptionsSchema,
  NotificationOptionsSchema,
  BooleanEnvVarSchema,
} from "./config.schema.js";

export type { MoneymanConfig } from "./config.schema.js";

export const systemName = "moneyman";
const logger = createLogger("config");

logger("Parsing config");
const config: MoneymanConfig = createConfig();
export { config };

function createConfig() {
  const { MONEYMAN_CONFIG, MONEYMAN_CONFIG_PATH } = process.env;
  if (MONEYMAN_CONFIG) {
    logger("Using MONEYMAN_CONFIG");
    try {
      const parsedConfig = parseJsoncConfig(MONEYMAN_CONFIG);
      return MoneymanConfigSchema.parse(parsedConfig);
    } catch (error) {
      logger(
        "Failed to parse MONEYMAN_CONFIG. Unable to continue with invalid configuration",
        error,
      );
      void sendConfigError(error);
    }
  }

  if (MONEYMAN_CONFIG_PATH) {
    logger(`Using MONEYMAN_CONFIG_PATH: ${MONEYMAN_CONFIG_PATH}`);
    try {
      const configFileContent = readFileSync(MONEYMAN_CONFIG_PATH, "utf-8");
      const parsedConfig = parseJsoncConfig(configFileContent);
      return MoneymanConfigSchema.parse(parsedConfig);
    } catch (error) {
      logger(
        "Failed to parse config file from MONEYMAN_CONFIG_PATH. Unable to continue with invalid configuration",
        error,
      );
      void sendConfigError(error);
    }
  }

  logToPublicLog(
    "No configuration found. Please provide MONEYMAN_CONFIG or MONEYMAN_CONFIG_PATH environment variable.",
  );

  return MoneymanConfigSchema.parse({});
}

// Function to send config to telegram if needed (to be called after imports are resolved)
export async function sendConfigToTelegramIfRequested() {
  if (BooleanEnvVarSchema.parse(process.env.SEND_NEW_CONFIG_TO_TG)) {
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
  const { MONEYMAN_CONFIG, MONEYMAN_CONFIG_PATH } = process.env;
  if (MONEYMAN_CONFIG) {
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
  } else if (MONEYMAN_CONFIG_PATH) {
    try {
      console.log("sendConfigError using MONEYMAN_CONFIG_PATH");
      const configFileContent = readFileSync(MONEYMAN_CONFIG_PATH, "utf-8");
      const config = parseJsoncConfig(configFileContent) as MoneymanConfig;
      if (config.options?.notifications?.telegram) {
        const { apiKey, chatId } = config.options.notifications.telegram;
        await new Telegraf(apiKey).telegram.sendMessage(chatId, message);
      }
    } catch (error) {
      console.error("Failed to send config error to telegram");
    }
  }
}
