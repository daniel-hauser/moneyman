import type { MoneymanConfig } from "./config.schema.js";
import type { AccountScrapeResult } from "./types.js";

export type ScrapeSelection = { choices: string[] } | { retryFailed: true };

export function selectionChoices(
  allowed: MoneymanConfig["accounts"],
): string[] {
  return [
    ...new Set(
      allowed
        .map((account) => account.scrapeId)
        .filter((id) => id !== undefined),
    ),
  ];
}

export type FailedLogin = Pick<AccountScrapeResult, "companyId" | "scrapeId">;

export function retryChoices(
  failures: FailedLogin[] | undefined,
  allowedIds: readonly string[],
) {
  if (!failures) return [];
  const eligible = failures
    .map((failure) => failure.scrapeId)
    .filter((id) => id !== undefined)
    .filter((id) => allowedIds.includes(id));
  return [...new Set(eligible)];
}
