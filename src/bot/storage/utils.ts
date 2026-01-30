import { formatISO, parseISO, roundToNearestMinutes } from "date-fns";
import type { CompanyTypes } from "israeli-bank-scrapers";
import type { Transaction } from "israeli-bank-scrapers/lib/transactions.js";
import { createLogger } from "../../utils/logger.js";

const logger = createLogger("transaction-utils");

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

  // For mizrahi bank, include TransactionNumber when != "1"
  // to handle duplicate identifiers that can occur within the same batch
  const rawTx = tx as Transaction & {
    rawTransaction?: Record<string, unknown>;
  };
  if (companyId === "mizrahi" && rawTx.rawTransaction) {
    const txNum = rawTx.rawTransaction.TransactionNumber;
    if (txNum && txNum !== "1") {
      logger(`Using TransactionNumber differentiator for mizrahi transaction`, {
        identifier: tx.identifier,
        amount: tx.chargedAmount,
        date: tx.date,
        transactionNumber: txNum,
      });
      parts.push(String(txNum));
    }
  }

  return parts.map((p) => String(p ?? "").trim()).join("_");
}
