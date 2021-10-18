import { GoogleSpreadsheet } from "google-spreadsheet";
import { transactionRow } from "./index.js";
import { FileHeaders, GOOGLE_SHEET_ID, WORKSHEET_NAME } from "./../config.js";
import type {
  TransactionRow,
  TransactionStorage,
  SaveStats,
} from "../types.js";


export class GoogleSheetsStorage implements TransactionStorage {
  existingTransactionsHashes = new Set<string>();

  private loadHashesPromise: null | Promise<void> = null;

  async init() {
    if (this.loadHashesPromise) {
      await this.loadHashesPromise;
    }

    this.loadHashesPromise = this.getHashes();
  }

  async saveTransactions(txns: Array<TransactionRow>) {
    await this.init();

    const sheet = await this.getWorkSheet();
    const rows = txns
      .filter((t) => !this.existingTransactionsHashes.has(t.hash))
      .map((t) => transactionRow(t));

    await sheet.addRows(rows);

    return {
      name: "GoogleSheetsStorage",
      replaced: 0, // TODO
      added: rows.length,
      skipped: txns.length - rows.length,
    } as SaveStats;
  }

  private async getHashes() {
    if (GOOGLE_SHEET_ID) {
      const sheet = await this.getWorkSheet();
      const rows = await sheet.getRows();
      for (let row of rows) {
        this.existingTransactionsHashes.add(row.hash);
      }
    }
  }

  private async getDoc() {
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);
    await doc.useServiceAccountAuth({
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY,
    });
    return doc;
  }

  private async getWorkSheet() {
    const doc = await this.getDoc();
    await doc.loadInfo();
    let sheet = doc.sheetsByTitle[WORKSHEET_NAME];
    if (!sheet) {
      sheet = await doc.addSheet({ title: WORKSHEET_NAME });
      await sheet.setHeaderRow(FileHeaders);
    }

    return sheet;
  }
}
