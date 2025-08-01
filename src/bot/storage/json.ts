import path from "node:path";
import fs from "node:fs/promises";
import { createLogger } from "../../utils/logger.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { createSaveStats } from "../saveStats.js";
import type { MoneymanConfig } from "../../config.js";

const logger = createLogger("LocalJsonStorage");

export class LocalJsonStorage implements TransactionStorage {
  static folder = path.join(process.cwd(), `output`);

  constructor(private config: MoneymanConfig) {}

  async init() {
    logger("init");
    await fs.mkdir(LocalJsonStorage.folder, { recursive: true });
  }

  canSave() {
    return Boolean(this.config.storage.localJson?.enabled);
  }

  async saveTransactions(txns: Array<TransactionRow>) {
    logger("saveTransactions");
    await this.init();

    const fileName = path.join(
      LocalJsonStorage.folder,
      `${new Date().toISOString().replace(/:/g, "_")}.json`,
    );

    await fs.appendFile(fileName, JSON.stringify(txns), { encoding: "utf8" });

    const stats = createSaveStats("LocalJsonStorage", fileName, txns, {
      added: txns.length,
    });

    return stats;
  }
}
