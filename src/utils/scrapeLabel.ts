import type { AccountScrapeResult } from "../types.js";

export function scrapeLabel({
  companyId,
  scrapeId,
}: Pick<AccountScrapeResult, "companyId" | "scrapeId">): string {
  return scrapeId === undefined ? companyId : `${companyId} · ${scrapeId}`;
}
