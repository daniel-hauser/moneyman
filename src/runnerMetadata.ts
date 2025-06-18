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
  const [domainsByCompany, networkInfo] = await Promise.all([
    getUsedDomains(),
    getExternalIp(),
  ]);
  await report({ domainsByCompany, networkInfo, metadataLogEntries });
}
