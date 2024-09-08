import { editMessage, send, sendError } from "../notifier.js";
import type { AccountScrapeResult, TransactionRow } from "../types.js";
import { LocalJsonStorage } from "./json.js";
import { GoogleSheetsStorage } from "./sheets.js";
import { AzureDataExplorerStorage } from "./azure-data-explorer.js";
import { transactionHash, transactionUniqueId } from "./utils.js";
import { YNABStorage } from "./ynab.js";
import { BuxferStorage } from "./buxfer.js";
import { WebPostStorage } from "./web-post.js";
import { saving } from "../messages.js";
import { createLogger } from "../utils/logger.js";
import { statsString } from "../saveStats.js";

const logger = createLogger("storage");

export const storages = [
  new LocalJsonStorage(),
  new GoogleSheetsStorage(),
  new AzureDataExplorerStorage(),
  new YNABStorage(),
  new BuxferStorage(),
  new WebPostStorage(),
].filter((s) => s.canSave());

export async function saveResults(results: Array<AccountScrapeResult>) {
  if (storages.length === 0) {
    await send("No storages found, skipping save");
    return;
  }

  const txns = resultsToTransactions(results);
  if (txns.length === 0) {
    await send("No transactions found, skipping save");
    return;
  }

  for (let storage of storages) {
    const { name } = storage.constructor;
    try {
      logger(`Initializing ${name}`);
      await storage.init();
    } catch (e) {
      logger(`Error initializing ${name}`, e);
      sendError(e, `init::${name}`);
    }

    try {
      logger(`Saving ${txns.length} transactions to ${name}`);
      const message = await send(saving(name));
      const stats = await storage.saveTransactions(txns);
      await editMessage(message?.message_id, statsString(stats));
    } catch (e) {
      logger(`Error saving transactions to ${name}`, e);
      sendError(e, `saveTransactions::${name}`);
    }
  }
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
            uniqueId: transactionUniqueId(tx, companyId, account.accountNumber),
          });
        }
      }
    }
  }

  return txns;
}
