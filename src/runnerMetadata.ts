import { RunMetadata } from "./types";
import { getUsedDomains } from "./security/domains.js";

export async function reportRunMetadata(
  report: (metadata: RunMetadata) => Promise<void>,
): Promise<void> {
  const [domainsByCompany] = await Promise.all([getUsedDomains()]);
  await report({ domainsByCompany });
}
