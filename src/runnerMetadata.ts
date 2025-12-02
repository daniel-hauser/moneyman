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

  // Collect promises only for enabled options
  const promises: Promise<unknown>[] = [];
  if (telegramConfig.reportUsedDomains) {
    promises.push(getUsedDomains());
  }
  if (telegramConfig.reportExternalIp) {
    promises.push(getExternalIp());
  }

  // Build metadata based on enabled options
  let domainsByCompany: RunMetadata["domainsByCompany"] = {};
  let networkInfo: RunMetadata["networkInfo"] = {};

  if (promises.length > 0) {
    const results = await Promise.all(promises);
    let resultIndex = 0;
    if (telegramConfig.reportUsedDomains) {
      domainsByCompany = results[
        resultIndex++
      ] as RunMetadata["domainsByCompany"];
    }
    if (telegramConfig.reportExternalIp) {
      networkInfo = results[resultIndex] as RunMetadata["networkInfo"];
    }
  }

  await report({ domainsByCompany, networkInfo, metadataLogEntries });
}
