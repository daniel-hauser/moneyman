import type { RunMetadata } from "./types.ts";
import { getUsedDomains } from "@moneyman/scraper";
import { createLogger, metadataLogEntries } from "@moneyman/common";

const logger = createLogger("runner-metadata");

export async function getExternalIp(): Promise<{ ip: string }> {
  try {
    const res = await fetch(
      process.env.GET_IP_INFO_URL || "https://ipinfo.io/json",
    );
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
