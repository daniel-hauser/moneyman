import { sendError } from "../notifier.js";
import type { AccountScrapeResult, TransactionRow } from "../types.js";
import { LocalJsonStorage } from "./json.js";
import { GoogleSheetsStorage } from "./sheets.js";
import { AzureDataExplorerStorage } from "./azure-data-explorer.js";
import { transactionHash } from "./utils.js";

export const storages = [
  new LocalJsonStorage(),
  new GoogleSheetsStorage(),
  new AzureDataExplorerStorage(),
].filter((s) => s.canSave());

export async function initializeStorage() {
  try {
    return Promise.all(storages.map((s) => s.init()));
  } catch (e) {
    sendError(e, "initializeStorage");
  }
}

export async function saveResults(results: Array<AccountScrapeResult>) {
  const txns = resultsToTransactions(results);

  if (txns.length) {
    const res = await Promise.all(
      storages.map((s) => s.saveTransactions(txns)),
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

function resultsToTransactions(
  results: Array<AccountScrapeResult>,
): Array<TransactionRow> {
  const txns: Array<TransactionRow> = [];

  for (let { result, companyId } of results) {
    if (result.success) {
      for (let account of result.accounts ?? []) {
        for (let tx of account.txns) {
          txns.push({
            ...tx,
            account: account.accountNumber,
            companyId,
            hash: transactionHash(tx, companyId, account.accountNumber),
          });
        }
      }
    }
  }

  return txns;
}
