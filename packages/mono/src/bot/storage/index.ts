import { editMessage, send, sendError } from "../notifier.ts";
import type {
  AccountScrapeResult,
  TransactionRow,
  TransactionStorage,
} from "../../types.ts";
import { LocalJsonStorage } from "./json.ts";
import { GoogleSheetsStorage } from "./sheets.ts";
import { AzureDataExplorerStorage } from "./azure-data-explorer.ts";
import { transactionHash, transactionUniqueId } from "./utils.ts";
import { YNABStorage } from "./ynab.ts";
import { BuxferStorage } from "./buxfer.ts";
import { WebPostStorage } from "./web-post.ts";
import { TelegramStorage } from "./telegram.ts";
import { saving } from "../messages.ts";
import { createLogger } from "@moneyman/common";
import { statsString } from "../saveStats.ts";
import { parallel } from "async";
import { Timer } from "../../utils/Timer.ts";
import { parseConfig } from "../../config/parser.ts";
import type { StorageConfigType } from "../../config/storage.schema.ts";

const baseLogger = createLogger("storage");
const parsedConfig = parseConfig();

// Extract global configuration that storage classes need
const globalConfig = {
  transactionHashType: parsedConfig.scraper.transactionHashType,
};

// Define storage class constructors with their configuration types
const storageFromConfigName = {
  localJson: (config) => new LocalJsonStorage(config),
  googleSheets: (config) => new GoogleSheetsStorage(config, globalConfig),
  azureDataExplorer: (config) => new AzureDataExplorerStorage(config),
  ynab: (config) => new YNABStorage(config, globalConfig),
  buxfer: (config) => new BuxferStorage(config),
  webPost: (config) => new WebPostStorage(config),
  telegram: (config) => new TelegramStorage(config),
} satisfies Record<
  keyof StorageConfigType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config: any) => TransactionStorage
>;

// Create storage instances based on configuration
export const storages = Object.entries(parsedConfig.storage)
  .filter(([, config]) => config)
  .map(([name, config]) =>
    storageFromConfigName[name as keyof typeof storageFromConfigName](config),
  )
  .filter((s) => s.canSave());

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

  await parallel(
    storages.map((storage: TransactionStorage) => async () => {
      const { name } = storage.constructor;
      const logger = baseLogger.extend(name);
      const steps: Array<Timer> = [];

      try {
        logger(`saving ${txns.length} transactions`);
        const message = await send(saving(name));
        const start = performance.now();
        const stats = await storage.saveTransactions(txns, async (step) => {
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
    }),
  );
}

function resultsToTransactions(
  results: Array<AccountScrapeResult>,
): Array<TransactionRow> {
  const txns: Array<TransactionRow> = [];

  for (const { result, companyId } of results) {
    if (result.success) {
      for (const account of result.accounts ?? []) {
        for (const tx of account.txns) {
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
