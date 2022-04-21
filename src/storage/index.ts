import { parseISO, roundToNearestMinutes, format } from "date-fns";
import type { CompanyTypes } from "israeli-bank-scrapers";
import type { Transaction } from "israeli-bank-scrapers/lib/transactions";
import { currentDate, systemName } from "../config.js";
import { sendError } from "../notifier.js";
import type { AccountScrapeResult, TransactionRow } from "../types.js";

import { GoogleSheetsStorage } from "./sheets.js";

const storages = [new GoogleSheetsStorage()];

export async function loadExistingHashes(startDate: Date) {
  try {
    return Promise.all(storages.map((s) => s.init()));
  } catch (e) {
    sendError(e);
  }
}

export async function saveResults(results: Array<AccountScrapeResult>) {
  const txns = resultsToTransactions(results);

  if (txns.length) {
    const res = await Promise.all(
      storages.map((s) => s.saveTransactions(txns))
    );

    return {
      saved: true,
      stats: res,
    };
  }
  return {
    saved: false,
    stats: [],
  };
}

export function transactionRow(tx: TransactionRow): Array<string> {
  return [
    /* date */ format(parseISO(tx.date), "dd/MM/yyyy", {}),
    /* amount */ String(tx.chargedAmount),
    /* description */ tx.description,
    /* memo */ tx.memo ?? "",
    /* category */ tx.category ?? "",
    /* account */ tx.account,
    /* hash */ tx.hash,
    /* comment */ "",
    /* scraped at */ currentDate,
    /* scraped by */ systemName,
  ];
}

export function transactionHash(
  tx: Transaction,
  companyId: CompanyTypes,
  accountNumber: string
) {
  const date = roundToNearestMinutes(parseISO(tx.date)).toISOString();
  return `${date}_${tx.chargedAmount}_${tx.description}_${tx.memo}_${companyId}_${accountNumber}`;
}

function resultsToTransactions(
  results: Array<AccountScrapeResult>
): Array<TransactionRow> {
  const txns: Array<TransactionRow> = [];

  for (let { result, companyId } of results) {
    if (result.success) {
      for (let account of result.accounts ?? []) {
        for (let tx of account.txns) {
          txns.push({
            ...tx,
            hash: transactionHash(tx, companyId, account.accountNumber),
            account: account.accountNumber,
          });
        }
      }
    }
  }

  return txns;
}
