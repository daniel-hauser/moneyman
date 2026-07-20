import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { parseJsoncConfig } from "@moneyman/common";
import {
  ExporterAppConfigSchema,
  ScraperAppConfigSchema,
  splitLegacyConfig,
  type SplitAppConfigs,
} from "@moneyman/protocol";
import { buildEgressConfigs } from "./egressConfig.js";

const outputRoot = requiredEnvironmentVariable("MONEYMAN_CONFIG_OUTPUT");
const rawConfig = readLegacyConfig();
const splitConfig = applyFilters(
  splitLegacyConfig(parseJsoncConfig(rawConfig)),
);

writeConfig(outputRoot, "scraper", splitConfig.scraper);
writeConfig(outputRoot, "exporter", splitConfig.exporter);
writeConfig(outputRoot, "notifier", splitConfig.notifier);
writeAuthenticationTokens(outputRoot);
writeEgressConfigs(outputRoot, splitConfig);

function readLegacyConfig(): string {
  const inlineConfig = process.env.MONEYMAN_CONFIG;
  if (inlineConfig) {
    return inlineConfig;
  }

  const configPath = process.env.MONEYMAN_CONFIG_PATH;
  if (configPath) {
    return readFileSync(configPath, "utf8");
  }

  throw new Error(
    "MONEYMAN_CONFIG or MONEYMAN_CONFIG_PATH is required for legacy configuration migration",
  );
}

function applyFilters(config: SplitAppConfigs): SplitAppConfigs {
  const accountFilter = commaSeparatedFilter(
    process.env.MONEYMAN_ACCOUNT_FILTER,
  );
  const storageFilter = commaSeparatedFilter(
    process.env.MONEYMAN_STORAGE_FILTER,
  );

  const scraper = accountFilter
    ? ScraperAppConfigSchema.parse({
        ...config.scraper,
        accounts: config.scraper.accounts.filter((account) =>
          accountFilter.has(account.companyId.toLowerCase()),
        ),
      })
    : config.scraper;

  if (accountFilter && scraper.accounts.length === 0) {
    throw new Error("The requested account filter matched no accounts");
  }

  const exporter = storageFilter
    ? ExporterAppConfigSchema.parse({
        ...config.exporter,
        storage: Object.fromEntries(
          Object.entries(config.exporter.storage).filter(([name]) =>
            storageFilter.has(name.toLowerCase()),
          ),
        ),
      })
    : config.exporter;

  if (
    storageFilter?.has("telegram") &&
    (!exporter.storage.telegram || !config.notifier.telegram)
  ) {
    throw new Error(
      "Telegram storage was requested but Telegram is not configured",
    );
  }

  return { ...config, scraper, exporter };
}

function commaSeparatedFilter(value: string | undefined) {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return entries && entries.length > 0 ? new Set(entries) : undefined;
}

function writeConfig<T extends keyof SplitAppConfigs>(
  root: string,
  service: T,
  value: SplitAppConfigs[T],
) {
  const target = join(root, service, "config.json");
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temporaryTarget = `${target}.tmp`;
  writeFileSync(temporaryTarget, JSON.stringify(value), {
    encoding: "utf8",
    mode: 0o444,
  });
  renameSync(temporaryTarget, target);
}

function writeAuthenticationTokens(root: string) {
  const scraperExporterToken = randomBytes(48).toString("base64url");
  const scraperNotifierToken = randomBytes(48).toString("base64url");
  const exporterNotifierToken = randomBytes(48).toString("base64url");

  writeSecret(root, "scraper", "exporter.token", scraperExporterToken);
  writeSecret(root, "exporter", "scraper.token", scraperExporterToken);
  writeSecret(root, "scraper", "notifier.token", scraperNotifierToken);
  writeSecret(root, "notifier", "scraper.token", scraperNotifierToken);
  writeSecret(root, "exporter", "notifier.token", exporterNotifierToken);
  writeSecret(root, "notifier", "exporter.token", exporterNotifierToken);
}

function writeEgressConfigs(root: string, configs: SplitAppConfigs) {
  const egressConfigs = buildEgressConfigs(configs);
  writeOutputJson(root, "scraper-egress", "config.json", egressConfigs.scraper);
  writeOutputJson(
    root,
    "exporter-egress",
    "config.json",
    egressConfigs.exporter,
  );
  writeOutputJson(
    root,
    "notifier-egress",
    "config.json",
    egressConfigs.notifier,
  );
}

function writeOutputJson(
  root: string,
  service: string,
  filename: string,
  value: unknown,
) {
  const target = join(root, service, filename);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, JSON.stringify(value), {
    encoding: "utf8",
    mode: 0o444,
  });
}

function writeSecret(
  root: string,
  service: string,
  filename: string,
  value: string,
) {
  const target = join(root, service, filename);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, value, { encoding: "utf8", mode: 0o444 });
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
