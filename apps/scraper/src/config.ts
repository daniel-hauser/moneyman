import { subDays } from "date-fns";
import type { CompanyTypes, ScraperCredentials } from "israeli-bank-scrapers";
import { loadConfig } from "@moneyman/common";
import {
  ScraperAppConfigSchema,
  type ScraperAppConfig,
} from "@moneyman/protocol";

export type AccountConfig = ScraperCredentials & {
  companyId: CompanyTypes;
};

export const config: ScraperAppConfig = loadConfig(ScraperAppConfigSchema, {
  inlineEnvironmentVariable: "MONEYMAN_SCRAPER_CONFIG",
  pathEnvironmentVariable: "MONEYMAN_SCRAPER_CONFIG_PATH",
});

const accounts = config.accounts as AccountConfig[];
const { accountsToScrape } = config.options.scraping;

export const scraperConfig = {
  accounts:
    !accountsToScrape || accountsToScrape.length === 0
      ? accounts
      : accounts.filter((account) =>
          accountsToScrape.includes(account.companyId),
        ),
  startDate: subDays(Date.now(), config.options.scraping.daysBack),
  parallelScrapers: config.options.scraping.maxParallelScrapers,
  futureMonthsToScrape: config.options.scraping.futureMonths,
  additionalTransactionInformation:
    config.options.scraping.additionalTransactionInfo,
  includeRawTransaction: config.options.scraping.includeRawTransaction,
};

export type ScraperRuntimeConfig = typeof scraperConfig;
