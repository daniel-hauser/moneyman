import { RunMetadata } from "./types";
import { getUsedDomains } from "./security/domains.js";

async function getExternalIp(): Promise<{ ip: string }> {
  const res = await fetch("https://ipinfo.io/json");
  return res.json();
}

export async function reportRunMetadata(
  report: (metadata: RunMetadata) => Promise<void>,
): Promise<void> {
  const [domainsByCompany, networkInfo] = await Promise.all([
    getUsedDomains(),
    getExternalIp(),
  ]);
  await report({ domainsByCompany, networkInfo });
}
