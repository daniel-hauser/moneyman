import type { RunMetadata } from "./types";
import { getUsedDomains } from "./security/domains.js";
import { createLogger, metadataLogEntries } from "./utils/logger.js";
import { config } from "./config.js";

const logger = createLogger("runner-metadata");

export async function getExternalIp(): Promise<{ ip: string }> {
  try {
    const res = await fetch(config.options.logging.getIpInfoUrl);
    return res.json();
  } catch (e) {
    logger("Failed to get external IP", e);
    return { ip: "unknown" };
  }
}

export async function reportRunMetadata(
  report: (metadata: RunMetadata) => Promise<void>,
): Promise<void> {
  const telegramConfig = config.options.notifications?.telegram;

  // Check if reportRunMetadata is enabled (opt-in, defaults to false)
  if (!telegramConfig?.reportRunMetadata) {
    logger("reportRunMetadata is disabled, skipping");
    return;
  }

  const [domainsByCompany, networkInfo] = await Promise.all([
    telegramConfig?.reportUsedDomains ? getUsedDomains() : {},
    telegramConfig?.reportExternalIp ? getExternalIp() : {},
  ]);

  await report({ domainsByCompany, networkInfo, metadataLogEntries });
}
