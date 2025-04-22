import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@moneyman/common";
import type { TransactionRow, TransactionStorage } from "../../types.ts";
import { createSaveStats } from "../saveStats.ts";
import type { LocalJsonConfigType } from "../../config/storage.schema.ts";

const logger = createLogger("LocalJsonStorage");

export class LocalJsonStorage implements TransactionStorage {
  static folder = path.join(process.cwd(), `output`);

  constructor(private config: LocalJsonConfigType) {}

  async init() {
    logger("init");
    await fs.promises.mkdir(LocalJsonStorage.folder, { recursive: true });
  }

  canSave() {
    return Boolean(this.config?.enabled);
  }

  async saveTransactions(txns: Array<TransactionRow>) {
    logger("saveTransactions");
    await this.init();

    const fileName = path.join(
      LocalJsonStorage.folder,
      `${new Date().toISOString().replace(/:/g, "_")}.json`,
    );

    await fs.promises.appendFile(fileName, JSON.stringify(txns), {
      encoding: "utf8",
    });

    const stats = createSaveStats("LocalJsonStorage", fileName, txns, {
      added: txns.length,
    });

    return stats;
  }
}
