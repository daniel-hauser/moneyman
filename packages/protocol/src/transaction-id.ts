import { formatISO, parseISO, roundToNearestMinutes } from "date-fns";
import type { Transaction } from "./types.js";

export function transactionHash(
  transaction: Transaction,
  companyId: string,
  accountNumber: string,
) {
  const date = roundToNearestMinutes(parseISO(transaction.date)).toISOString();
  const parts = [
    date,
    transaction.chargedAmount,
    transaction.description,
    transaction.memo,
    companyId,
    accountNumber,
  ];

  return parts.map((part) => String(part ?? "")).join("_");
}

export function transactionUniqueId(
  transaction: Transaction,
  companyId: string,
  accountNumber: string,
) {
  const date = formatISO(transaction.date, {
    representation: "date",
  });

  const parts = [
    date,
    companyId,
    accountNumber,
    transaction.chargedAmount,
    transaction.identifier || `${transaction.description}_${transaction.memo}`,
  ];
  return parts.map((part) => String(part ?? "").trim()).join("_");
}
