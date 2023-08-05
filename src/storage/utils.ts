import { parseISO, roundToNearestMinutes } from "date-fns";
import type { CompanyTypes } from "israeli-bank-scrapers";
import type { Transaction } from "israeli-bank-scrapers/lib/transactions";

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
