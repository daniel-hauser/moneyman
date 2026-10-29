import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { config } from "./config.js";
import { MoneymanConfigSchema, type MoneymanConfig } from "./config.schema.js";
import { getConfigSecretEnvironment } from "./configSecret.js";
import { workerEnvironment } from "./scraper/environment.js";
import { parseJsoncConfig } from "./utils/jsonc.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("secrets-refresh");
const bootstrap = {
  MONEYMAN_CONFIG_SECRET: process.env.MONEYMAN_CONFIG_SECRET,
  MONEYMAN_CONFIG_SECRET_PROVIDER: process.env.MONEYMAN_CONFIG_SECRET_PROVIDER,
  MONEYMAN_CONFIG_SECRET_ID: process.env.MONEYMAN_CONFIG_SECRET_ID,
  BITWARDEN_ACCESS_TOKEN: process.env.BITWARDEN_ACCESS_TOKEN,
};
export const SECRET_REFRESH_FAILURE =
  "Secret refresh failed. No scrape started. Check the private logs and provider access, then retry.";

export function hasConfigSecretProvider(): boolean {
  return Boolean(
    bootstrap.MONEYMAN_CONFIG_SECRET ||
    bootstrap.MONEYMAN_CONFIG_SECRET_PROVIDER,
  );
}

export async function loadRunConfig(): Promise<MoneymanConfig> {
  if (!hasConfigSecretProvider()) return config;

  try {
    const environment = getConfigSecretEnvironment(
      bootstrap.MONEYMAN_CONFIG_SECRET || {
        provider: bootstrap.MONEYMAN_CONFIG_SECRET_PROVIDER,
        secretId: bootstrap.MONEYMAN_CONFIG_SECRET_ID,
        accessToken: bootstrap.BITWARDEN_ACCESS_TOKEN,
      },
    );

    // The launcher removes the descriptor, but retains these bootstrap values.
    // Never let the already-resolved MONEYMAN_CONFIG override the provider.
    const childEnvironment = {
      ...workerEnvironment(process.env),
      VARLOCK_TELEMETRY_DISABLED: "1",
      BITWARDEN_ACCESS_TOKEN: environment.BITWARDEN_ACCESS_TOKEN,
      MONEYMAN_CONFIG_SECRET_ID: environment.MONEYMAN_CONFIG_SECRET_ID,
    };
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    execFile(
      process.execPath,
      [
        fileURLToPath(
          new URL("../node_modules/varlock/bin/cli.js", import.meta.url),
        ),
        "load",
        "--format",
        "json",
        "--filter",
        "MONEYMAN_CONFIG",
        "--path",
        fileURLToPath(new URL("../.env.schema", import.meta.url)),
        "--skip-cache",
      ],
      {
        env: childEnvironment,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          logger("Varlock secret refresh failed", error, stderr);
          reject(error);
        } else {
          resolve(stdout);
        }
      },
    );
    const output = JSON.parse(await promise) as Record<string, unknown>;
    const value = output.MONEYMAN_CONFIG;
    if (typeof value !== "string" || !value) {
      throw new Error("Provider returned no configuration");
    }
    const fresh = MoneymanConfigSchema.parse(parseJsoncConfig(value));

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
