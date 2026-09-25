import { formatISO, parseISO, roundToNearestMinutes } from "date-fns";
import type { CompanyTypes } from "israeli-bank-scrapers";
import {
  type Transaction,
  TransactionStatuses,
} from "israeli-bank-scrapers/lib/transactions.js";
import type { TransactionRow } from "../../types.js";

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

  // Pending transactions report chargedAmount as 0; fall back to originalAmount
  // so two pending transactions with different original amounts get distinct ids.
  // Non-pending transactions preserve chargedAmount even when it is 0.
  const isPending = tx.status === TransactionStatuses.Pending;
  const amount =
    isPending && tx.chargedAmount === 0 ? tx.originalAmount : tx.chargedAmount;

  const parts = [
    date,
    companyId,
    accountNumber,
    amount,
    tx.identifier || `${tx.description}_${tx.memo}`,
  ];
  return parts.map((p) => String(p ?? "").trim()).join("_");
}

/**
 * Appends a numeric suffix to uniqueIds that collide within the same batch.
 * The first occurrence keeps its original uniqueId (backwards-compatible);
 * subsequent occurrences get `_1`, `_2`, etc.
 *
 * This handles legitimately identical-looking transactions (e.g. buying the
 * same item twice on the same day with no bank-assigned identifier) so they
 * are stored as distinct rows instead of being merged or silently dropped.
 */
export function disambiguateDuplicateIds(
  txns: Array<TransactionRow>,
): Array<TransactionRow> {
  const counts = new Map<string, number>();
  // Pre-populate with all original uniqueIds so generated suffixes never
  // collide with a natural ID that appears later in the batch.
  const seen = new Set<string>(txns.map((tx) => tx.uniqueId));

  return txns.map((tx) => {
    const base = tx.uniqueId;
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);

    if (count === 0) return tx;

    let n = count;
    while (seen.has(`${base}_${n}`)) {
      n++;
    }
    const uniqueId = `${base}_${n}`;
    seen.add(uniqueId);
    counts.set(base, n + 1);
    return { ...tx, uniqueId };
  });
}
