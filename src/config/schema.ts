import { z } from "zod";
import { AccountsArray } from "./accounts.schema.js";
import { StorageConfig } from "./storage.schema.js";

// Scraper configuration schema
const ScraperConfig = z.object({
  // Account configuration
  accounts: AccountsArray.describe(
    "array of accounts to scrape following the israeli-bank-scrapers schema",
  ),
  accountsToScrape: z
    .string()
    .default("")
    .transform((value) => value.split(","))
    .describe(
      "Comma separated list of providers to take from accountsJson. If empty, all accounts will be used",
    ),
  daysBack: z.coerce
    .number()
    .default(10)
    .describe("The amount of days back to scrape"),
  futureMonths: z.coerce
    .number()
    .default(1)
    .describe(
      "The amount of months that will be scrapped in the future, starting from the day calculated using daysBack",
    ),
  timezone: z
    .string()
    .default("Asia/Jerusalem")
    .describe("Timezone for the process - used for formatting timestamps"),
  maxParallelScrapers: z.coerce
    .number()
    .default(1)
    .describe("The maximum number of parallel scrapers to run"),
  puppeteerExecutablePath: z
    .string()
    .optional()
    .describe(
      "ExecutablePath for the scraper. If undefined defaults to system",
    ),
  transactionHashType: z
    .enum(["", "moneyman"])
    .default("")
    .describe("The hash type to use for the transaction hash"),
  domainTrackingEnabled: z
    .boolean()
    .default(false)
    .describe("Enable tracking of all domains accessed during scraping"),
  hiddenDeprecations: z
    .array(z.string())
    .default([])
    .describe("List of deprecations to hide"),
  firewallSettings: z
    .string()
    .optional()
    .describe(
      "Configuration for firewall settings, filtering domains during scraping",
    ),
});

const NotifierConfig = z.object({
  telegram: z
    .object({
      apiKey: z.string().describe("Telegram bot API key for notifications"),
      chatId: z.string().describe("Telegram chat ID to send notifications to"),
    })
    .optional(),
});

// Main configuration schema
export const Config = z.object({
  scraper: ScraperConfig,
  notifier: NotifierConfig,
  storage: StorageConfig,
});
