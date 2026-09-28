import { formatISO, parseISO, roundToNearestMinutes } from "date-fns";
import type { CompanyTypes } from "israeli-bank-scrapers";
import type { Transaction } from "israeli-bank-scrapers/lib/transactions.js";
import { createHash } from "node:crypto";

/**
 * Generates a hash for a transaction that can be used to ~uniquely identify it.
 * The hash is backwards compatible with the caspion hash.
 */
export function transactionHash(
  tx: Transaction,
  companyId: CompanyTypes,
  accountNumber: string,
) {
  const date = roundToNearestMinutes(parseISO(tx.date)).toISOString();
  const parts = [
    date,
    tx.chargedAmount,
    tx.description,
    tx.memo,
    companyId,
    accountNumber,
  ];

  return parts.map((p) => String(p ?? "")).join("_");
}

/**
 *
 * @param tx
 * @param companyId
 * @param accountNumber
 * @returns A unique id for a transaction
 */
export function transactionUniqueId(
  tx: Transaction,
  companyId: CompanyTypes,
  accountNumber: string,
) {
  const date = formatISO(tx.date, {
    representation: "date",
  });

  const parts = [
    date,
    companyId,
    accountNumber,
    tx.chargedAmount,
    tx.identifier || `${tx.description}_${tx.memo}`,
  ];
  return parts.map((p) => String(p ?? "").trim()).join("_");
}

/**
 * Creates a deterministic, stable hash of a string.
 *
 * Used for external import ids (e.g. YNAB's `import_id`), so it must stay
 * stable across releases and runs - therefore it uses node's built-in sha256
 * and not a library that may change its algorithm.
 *
 * The result is truncated to 32 characters to fit YNAB's 36 character limit.
 */
export function stableHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}
