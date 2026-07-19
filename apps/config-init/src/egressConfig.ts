import {
  EgressConfigSchema,
  SQL_EGRESS_PORT,
  type EgressConfig,
  type EgressDestination,
} from "@moneyman/common";
import type { SplitAppConfigs } from "@moneyman/protocol";
import { parseIntoClientConfig } from "pg-connection-string";

export interface ServiceEgressConfigs {
  scraper: EgressConfig;
  exporter: EgressConfig;
  notifier: EgressConfig;
}

export function buildEgressConfigs(
  configs: SplitAppConfigs,
): ServiceEgressConfigs {
  const scraperDestinations = new Map<string, Set<number>>();
  for (const rawRule of configs.scraper.options.security.firewallSettings ??
    []) {
    const rule = rawRule.trim();
    if (!rule || rule.startsWith("#")) {
      continue;
    }
    const match = rule.match(/^\S+\s+ALLOW\s+(\S+)$/);
    if (match) {
      addDestination(scraperDestinations, match[1], 80, 443);
    }
  }
  const ipInfoUrl = configs.scraper.options.logging.getIpInfoUrl;
  if (ipInfoUrl) {
    addUrlDestination(scraperDestinations, ipInfoUrl);
  }

  const exporter = exporterEgressConfig(configs.exporter);
  return {
    scraper: EgressConfigSchema.parse({
      mode: configs.scraper.options.security.blockByDefault
        ? "allowlist"
        : "public",
      destinations: serializeDestinations(scraperDestinations),
    }),
    exporter,
    notifier: EgressConfigSchema.parse({
      mode: "allowlist",
      destinations: [{ hostname: "api.telegram.org", ports: [443] }],
    }),
  };
}

function exporterEgressConfig(
  config: SplitAppConfigs["exporter"],
): EgressConfig {
  const destinations = new Map<string, Set<number>>();
  const tcpForwards: EgressConfig["tcpForwards"] = [];
  const { storage } = config;

  if (storage.googleSheets) {
    addDestination(destinations, "googleapis.com", 443);
  }
  if (storage.ynab) {
    addDestination(destinations, "api.ynab.com", 443);
  }
  if (storage.azure) {
    addUrlDestination(destinations, storage.azure.ingestUri);
    addDestination(destinations, "login.microsoftonline.com", 443);
    addDestination(destinations, "blob.core.windows.net", 443);
    addDestination(destinations, "queue.core.windows.net", 443);
  }
  if (storage.buxfer) {
    addDestination(destinations, "www.buxfer.com", 443);
    addDestination(destinations, "api.buxfer.com", 443);
  }
  if (storage.actual) {
    addUrlDestination(destinations, storage.actual.serverUrl);
  }
  if (storage.webPost) {
    addUrlDestination(destinations, storage.webPost.url);
  }
  if (storage.sql) {
    try {
      if (!/^postgres(?:ql)?:\/\//i.test(storage.sql.connectionString)) {
        throw new Error("SQL connection string must use PostgreSQL URI syntax");
      }
      const target = parseIntoClientConfig(storage.sql.connectionString);
      if (!target.host) {
        throw new Error("SQL connection string does not contain a hostname");
      }
      tcpForwards.push({
        listenPort: SQL_EGRESS_PORT,
        hostname: normalizeHostname(target.host),
        port: target.port ?? 5432,
      });
    } catch (error) {
      throw new Error("Unable to derive the SQL storage egress target", {
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
      addUrlDestination(destinations, decoded.u);
    } catch (error) {
      throw new Error("Unable to derive the Moneyman storage egress target", {
        cause: error,
      });
    }
  }

  return EgressConfigSchema.parse({
    mode: "allowlist",
    destinations: serializeDestinations(destinations),
    tcpForwards,
  });
}

function addUrlDestination(
  destinations: Map<string, Set<number>>,
  value: string,
) {
  const url = new URL(value);
  const defaultPort =
    url.protocol === "http:" ? 80 : url.protocol === "https:" ? 443 : 0;
  if (defaultPort === 0) {
    throw new Error(`Unsupported egress URL protocol ${url.protocol}`);
  }
  addDestination(
    destinations,
    url.hostname,
    Number.parseInt(url.port || String(defaultPort), 10),
  );
}

function addDestination(
  destinations: Map<string, Set<number>>,
  hostname: string,
  ...ports: number[]
) {
  const normalized = normalizeHostname(hostname);
  const destinationPorts = destinations.get(normalized) ?? new Set<number>();
  ports.forEach((port) => destinationPorts.add(port));
  destinations.set(normalized, destinationPorts);
}

function serializeDestinations(
  destinations: Map<string, Set<number>>,
): EgressDestination[] {
  return [...destinations.entries()].map(([hostname, ports]) => ({
    hostname,
    ports: [...ports].sort((left, right) => left - right),
  }));
}

function normalizeHostname(value: string) {
  return value
    .replace(/^\*\./, "")
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}
