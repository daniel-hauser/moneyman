import "dotenv/config";
import { subDays } from "date-fns";
import { AccountConfig, ScraperConfig } from "./types.js";
import { createLogger, logToPublicLog } from "./utils/logger.js";
import { parseConfig } from "./config/parser.js";

export const systemName = "moneyman";
const logger = createLogger("config");

logger("Parsing config");
logToPublicLog("Parsing config");

const config = parseConfig();

logger("Env", {
  systemName,
  systemTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

logger("Config parsed", {
  accountsCount: config.scraper.accounts.length,
  storages: Object.keys(config.storage),
  notifier: Object.keys(config.notifier),
});

export const scraperConfig: ScraperConfig = {
  accounts: getFilteredAccounts(config.scraper),
  startDate: subDays(Date.now(), config.scraper.daysBack),
  parallelScrapers: config.scraper.maxParallelScrapers,
  futureMonthsToScrape: config.scraper.futureMonths,
};

/**
 * Filters accounts based on accountsToScrape setting
 */
function getFilteredAccounts({
  accounts,
  accountsToScrape,
}: (typeof config)["scraper"]): Array<AccountConfig> {
  // If no account filters specified, return all accounts
  if (
    accountsToScrape.length === 0 ||
    (accountsToScrape.length === 1 && accountsToScrape[0] === "")
  ) {
    return accounts;
  }

  // Otherwise filter to only the specified accounts
  return accounts.filter((account) =>
    accountsToScrape.includes(account.companyId),
  );
}
