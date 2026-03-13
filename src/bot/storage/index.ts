import { parallel } from "async";
import {
  AccountScrapeResult,
  TransactionRow,
  TransactionStorage,
} from "../../types.js";
import { config } from "../../config.js";
import { createLogger } from "../../utils/logger.js";
import { loggerContextStore } from "../../utils/asyncContext.js";
import { Timer } from "../../utils/Timer.js";
import { saving } from "../messages.js";
import { editMessage, send, sendError } from "../notifier.js";
import { statsString } from "../saveStats.js";
import { ActualBudgetStorage } from "./actual.js";
import { AzureDataExplorerStorage } from "./azure-data-explorer.js";
import { BuxferStorage } from "./buxfer.js";
import { InvoiceCreator } from "./InvoiceCreator.js";
import { LocalJsonStorage } from "./json.js";
import { GoogleSheetsStorage } from "./sheets.js";
import { transactionHash, transactionUniqueId } from "./utils.js";
import { WebPostStorage } from "./web-post.js";
import { TelegramStorage } from "./telegram.js";
import { YNABStorage } from "./ynab.js";
import { MondayStorage } from "./monday.js";
import { SqlStorage } from "./sql.js";

const baseLogger = createLogger("storage");

/**
 * Filters transactions to only include those from insurance vendors
 * @param transactions Array of transactions to filter
 * @returns Filtered transactions that match insurance vendors
 */
function filterInsuranceVendorTransactions(transactions: TransactionRow[]): TransactionRow[] {
  const vendors = [
    "ילין",
    "אלטשולר",
    "מור",
    "אנליסט",
    "מגדל",
    "כלל",
    "הראל",
    "פניקס",
    "מנורה",
  ];
  const vendorRegex = new RegExp(vendors.join("|"));

  return transactions
    .filter(txn => txn.originalAmount > 0)
    .filter(txn => typeof txn.description === "string" && vendorRegex.test(txn.description));
}

export const storages = [
  new LocalJsonStorage(config),
  new GoogleSheetsStorage(config),
  new AzureDataExplorerStorage(config),
  new YNABStorage(config),
  new BuxferStorage(config),
  new WebPostStorage(config),
  new TelegramStorage(config),
  new ActualBudgetStorage(config),
  new MondayStorage(config),
  new SqlStorage(config),
].filter((s) => s.canSave());

export async function saveResults(results: Array<AccountScrapeResult>) {
  if (storages.length === 0) {
    await send("No storages found, skipping save");
    return;
  }

  const allTransactions = resultsToTransactions(results);

  if (allTransactions.length === 0) {
    await send("No transactions found, skipping save");
    return;
  }

  // Create invoices for filtered insurance vendor transactions
  if (config.storage.invoice) {
    const txns = filterInsuranceVendorTransactions(allTransactions);
    if (txns.length > 0) {
      const invoiceCreator = new InvoiceCreator(config);
      try {
        await invoiceCreator.createInvoicesForTransactions(txns);
        baseLogger("Invoice creation completed for", txns.length, "transactions");
      } catch (e) {
        baseLogger("Error creating invoices:", e);
        await sendError(e, "InvoiceCreator");
      }
    } else {
      baseLogger("No insurance vendor transactions found for invoice creation");
    }
  }

  await parallel(
    storages.map((storage: TransactionStorage) => async () => {
      const { name } = storage.constructor;
      const logger = baseLogger.extend(name);
      const steps: Array<Timer> = [];

      return loggerContextStore.run({ prefix: `[${name}]` }, async () => {
        try {
          logger(`saving ${allTransactions.length} transactions`);
          const message = await send(saving(name));
          const start = performance.now();
          const stats = await storage.saveTransactions(allTransactions, async (step) => {
            steps.at(-1)?.end();
            steps.push(new Timer(step));
            await editMessage(message?.message_id, saving(name, steps));
          });
          const duration = performance.now() - start;
          steps.at(-1)?.end();
          logger(`saved`);
          await editMessage(
            message?.message_id,
            statsString(stats, duration, steps),
          );
        } catch (e) {
          logger(`error saving transactions`, e);
          sendError(e, `saveTransactions::${name}`);
        }
      });
    }),
  );
}

function resultsToTransactions(
  results: Array<AccountScrapeResult>,
): Array<TransactionRow> {
  const txns: Array<TransactionRow> = [];

  for (let { result, companyId } of results) {
    if (result.success) {
      for (let account of result.accounts ?? []) {
        for (let tx of account.txns) {
          try {
            txns.push({
              ...tx,
              account: account.accountNumber,
              companyId,
              hash: transactionHash(tx, companyId, account.accountNumber),
              uniqueId: transactionUniqueId(
                tx,
                companyId,
                account.accountNumber,
              ),
            });
          } catch (error) {
            // Skip transactions that fail hash generation and report the error
            // Note: The full transaction object is intentionally included for debugging
            // purposes as requested in the issue. This is sent via Telegram to help
            // diagnose malformed transactions.
            sendError(
              error,
              `Failed to process transaction for ${companyId} account ${account.accountNumber}:\n${JSON.stringify(tx, null, 2)}`,
            );
          }
        }
      }
    }
  }

  return txns;
}