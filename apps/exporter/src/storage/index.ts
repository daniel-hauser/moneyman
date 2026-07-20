import { Timer, createLogger, loggerContextStore } from "@moneyman/common";
import type { SaveContext, ScrapePayload } from "@moneyman/protocol";
import { config } from "../config.js";
import { saving } from "../messages.js";
import { editMessage, send, sendError } from "../notifier.js";
import { statsString } from "../saveStats.js";
import type { TransactionStorage } from "../types.js";

const baseLogger = createLogger("storage");

export async function savePayload(payload: ScrapePayload) {
  const storages = await createStorages();
  if (storages.length === 0) {
    await send("No storages found, skipping save");
    return storages;
  }

  if (payload.transactions.length === 0) {
    await send("No transactions found, skipping save");
    return storages;
  }

  const context: SaveContext = {
    accountResults: payload.accountResults,
  };

  await Promise.all(
    storages.map(async (storage) => {
      const { name } = storage.constructor;
      const logger = baseLogger.extend(name);
      const steps: Timer[] = [];

      await loggerContextStore.run({ prefix: `[${name}]` }, async () => {
        try {
          logger(`saving ${payload.transactions.length} transactions`);
          const message = await send(saving(name));
          const start = performance.now();
          const stats = await storage.saveTransactions(
            payload.transactions,
            async (step) => {
              steps.at(-1)?.end();
              steps.push(new Timer(step));
              await editMessage(message.messageId, saving(name, steps));
            },
            context,
          );
          const duration = performance.now() - start;
          steps.at(-1)?.end();
          await editMessage(
            message.messageId,
            statsString(stats, duration, steps),
          );
        } catch (error) {
          logger("error saving transactions", error);
          await sendError(error, `saveTransactions::${name}`);
          throw error;
        }
      });
    }),
  );

  return storages;
}

async function createStorages(): Promise<TransactionStorage[]> {
  const storages: TransactionStorage[] = [];

  if (config.storage.localJson) {
    const { LocalJsonStorage } = await import("./json.js");
    storages.push(new LocalJsonStorage(config));
  }
  if (config.storage.googleSheets) {
    const { GoogleSheetsStorage } = await import("./sheets.js");
    storages.push(new GoogleSheetsStorage(config));
  }
  if (config.storage.azure) {
    const { AzureDataExplorerStorage } =
      await import("./azure-data-explorer.js");
    storages.push(new AzureDataExplorerStorage(config));
  }
  if (config.storage.ynab) {
    const { YNABStorage } = await import("./ynab.js");
    storages.push(new YNABStorage(config));
  }
  if (config.storage.buxfer) {
    const { BuxferStorage } = await import("./buxfer.js");
    storages.push(new BuxferStorage(config));
  }
  if (config.storage.webPost) {
    const { WebPostStorage } = await import("./web-post.js");
    storages.push(new WebPostStorage(config));
  }
  if (config.storage.telegram?.enabled) {
    const { TelegramStorage } = await import("./telegram.js");
    storages.push(new TelegramStorage(config));
  }
  if (config.storage.actual) {
    const { ActualBudgetStorage } = await import("./actual.js");
    storages.push(new ActualBudgetStorage(config));
  }
  if (config.storage.sql) {
    const { SqlStorage } = await import("./sql.js");
    storages.push(new SqlStorage(config));
  }
  if (config.storage.moneyman) {
    const { MoneymanDashStorage } = await import("./moneyman.js");
    storages.push(new MoneymanDashStorage(config));
  }

  return storages.filter((storage) => storage.canSave());
}
