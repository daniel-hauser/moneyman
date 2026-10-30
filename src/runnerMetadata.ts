import { mergeUsedDomains, type UsedDomains } from "./security/domains.js";
import { createLogger } from "./utils/logger.js";
import { config } from "./config.js";

const logger = createLogger("runner-metadata");

export async function getExternalIp(): Promise<{ ip: string }> {
  const ipInfoUrl = config.options.logging.getIpInfoUrl;

  if (ipInfoUrl === false) {
    return { ip: "disabled" };
  }

  try {
    const res = await fetch(ipInfoUrl);
    return res.json();
  } catch (e) {
    logger("Failed to get external IP", e);
    return { ip: "unknown" };
  }
}

export async function logRunMetadata(...domains: UsedDomains[]): Promise<void> {
  const usedDomains = mergeUsedDomains(...domains);
  logger("Used domains:", usedDomains);
}
