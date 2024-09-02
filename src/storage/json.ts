import path from "node:path";
import fs from "node:fs/promises";
import { createLogger } from "./../utils/logger.js";
import type {
  TransactionRow,
  TransactionStorage,
  SaveStats,
} from "../types.js";
import { saved } from "../messages.js";

const logger = createLogger("LocalJsonStorage");

export class LocalJsonStorage implements TransactionStorage {
  static folder = path.join(process.cwd(), `output`);

  async init() {
    logger("init");
    await fs.mkdir(LocalJsonStorage.folder, { recursive: true });
  }

  canSave() {
    return Boolean(process.env.LOCAL_JSON_STORAGE);
  }

  async saveTransactions(txns: Array<TransactionRow>) {
    logger("saveTransactions");
    await this.init();

    const fileName = path.join(
      LocalJsonStorage.folder,
      `${new Date().toISOString().replace(/:/g, "_")}.json`,
    );

    await fs.appendFile(fileName, JSON.stringify(txns), { encoding: "utf8" });

    const stats: SaveStats = {
      name: "LocalJsonStorage",
      table: fileName,
      total: txns.length,
      added: txns.length,
      updated: 0,
      pending: NaN,
      skipped: 0,
      existing: NaN,
    };

    return stats;
  }
  logStats(stats: SaveStats): string {
    return saved(stats);
  }
}
