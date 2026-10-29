import { config, configSecret } from "./config.js";
import { type MoneymanConfig } from "./config.schema.js";
import { loadConfigSecret } from "./configSecret.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("secrets-refresh");
export const SECRET_REFRESH_FAILURE =
  "Secret refresh failed. No scrape started. Check the private logs and provider access, then retry.";

export function hasConfigSecretProvider(): boolean {
  return Boolean(configSecret);
}

export async function loadRunConfig(): Promise<MoneymanConfig> {
  if (!hasConfigSecretProvider()) return config;

  try {
    const fresh = await loadConfigSecret(configSecret);

    return {
      ...config,
      accounts: fresh.accounts,
      storage: fresh.storage,
      options: {
        ...config.options,
        scraping: fresh.options.scraping,
        security: fresh.options.security,
      },
    };
  } catch (error) {
    logger("Unable to refresh configuration", error);
    throw new Error(SECRET_REFRESH_FAILURE);
  }
}
