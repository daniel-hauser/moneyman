import path from "node:path";
import fs from "node:fs/promises";
import { createLogger } from "@moneyman/common";
import type { ExporterAppConfig, TransactionRow } from "@moneyman/protocol";
import type { TransactionStorage } from "../types.js";
import { createSaveStats } from "../saveStats.js";

const logger = createLogger("LocalJsonStorage");

export class LocalJsonStorage implements TransactionStorage {
  folder: string;

  constructor(private config: ExporterAppConfig) {
    this.folder =
      this.config.storage.localJson?.path || path.join(process.cwd(), `output`);
  }

  async init() {
    logger("init");
    await fs.mkdir(this.folder, { recursive: true });
  }

  canSave() {
    return Boolean(this.config.storage.localJson?.enabled);
  }

  async saveTransactions(txns: Array<TransactionRow>) {
    logger("saveTransactions");
    await this.init();

    const fileName = path.join(
      this.folder,
      `${new Date().toISOString().replace(/:/g, "_")}.json`,
    );

    await fs.appendFile(fileName, JSON.stringify(txns), { encoding: "utf8" });

    const stats = createSaveStats("LocalJsonStorage", fileName, txns, {
      added: txns.length,
    });

    return stats;
  }
}
