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
  const scraperAllowlist = new Set<string>();
  for (const rule of configs.scraper.options.security.firewallSettings ?? []) {
    const match = rule.match(/^\S+\s+ALLOW\s+(\S+)$/);
    if (match) {
      scraperAllowlist.add(normalizeHostname(match[1]));
    }
  }
  const ipInfoUrl = configs.scraper.options.logging.getIpInfoUrl;
  if (ipInfoUrl) {
    scraperAllowlist.add(new URL(ipInfoUrl).hostname);
  }

  const exporterAllowlist = exporterHosts(configs.exporter);
  writeOutputJson(root, "scraper-egress", "config.json", {
    mode: configs.scraper.options.security.blockByDefault
      ? "allowlist"
      : "public",
    allowlist: [...scraperAllowlist],
  });
  writeOutputJson(root, "exporter-egress", "config.json", {
    mode: "allowlist",
    allowlist: [...exporterAllowlist],
  });
  writeOutputJson(root, "notifier-egress", "config.json", {
    mode: "allowlist",
    allowlist: ["api.telegram.org"],
  });
}

function exporterHosts(config: SplitAppConfigs["exporter"]): Set<string> {
  const hosts = new Set<string>();
  const { storage } = config;

  if (storage.googleSheets) {
    hosts.add("googleapis.com");
  }
  if (storage.ynab) {
    hosts.add("api.ynab.com");
  }
  if (storage.azure) {
    hosts.add(new URL(storage.azure.ingestUri).hostname);
    hosts.add("login.microsoftonline.com");
  }
  if (storage.buxfer) {
    hosts.add("www.buxfer.com");
    hosts.add("api.buxfer.com");
  }
  if (storage.actual) {
    hosts.add(new URL(storage.actual.serverUrl).hostname);
  }
  if (storage.webPost) {
    hosts.add(new URL(storage.webPost.url).hostname);
  }
  if (storage.sql) {
    try {
      hosts.add(new URL(storage.sql.connectionString).hostname);
    } catch (error) {
      throw new Error("Unable to derive the SQL storage egress host", {
        cause: error,
      });
    }
  }
  if (storage.moneyman) {
    try {
      const encoded = storage.moneyman.token.slice("mm_".length);
      const decoded = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as { u?: unknown };
      if (typeof decoded.u !== "string") {
        throw new Error("Moneyman token does not contain an egress URL");
      }
      hosts.add(new URL(decoded.u).hostname);
    } catch (error) {
      throw new Error("Unable to derive the Moneyman storage egress host", {
        cause: error,
      });
    }
  }

  return hosts;
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

function normalizeHostname(value: string) {
  return value.replace(/^\*\./, "").replace(/\.$/, "").toLowerCase();
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
