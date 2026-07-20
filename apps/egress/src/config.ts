import { readFileSync } from "node:fs";
import { EgressConfigSchema, type EgressConfig } from "@moneyman/common";
import { normalizeProxyHostname } from "./networkPolicy.js";

export function loadEgressConfig(): EgressConfig {
  const path = process.env.MONEYMAN_EGRESS_CONFIG_PATH;
  if (!path) {
    throw new Error("MONEYMAN_EGRESS_CONFIG_PATH is required");
  }
  return EgressConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function isAllowedDestination(
  config: EgressConfig,
  hostname: string,
  port: number,
): boolean {
  if (config.mode === "public") {
    return port === 80 || port === 443;
  }

  const normalized = normalizeProxyHostname(hostname);
  return config.destinations.some(
    (destination) =>
      destination.ports.includes(port) &&
      (normalized === destination.hostname ||
        normalized.endsWith(`.${destination.hostname}`)),
  );
}
