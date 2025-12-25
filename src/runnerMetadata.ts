import { getUsedDomains } from "./security/domains.js";
import { createLogger } from "./utils/logger.js";
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

export async function logRunMetadata(): Promise<void> {
  const domainsByCompany = await getUsedDomains();
  logger("Used domains by company:", domainsByCompany);
}
