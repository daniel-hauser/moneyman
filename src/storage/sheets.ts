import { GoogleSpreadsheet } from "google-spreadsheet";
import { transactionRow } from "./index.js";
import { FileHeaders, GOOGLE_SHEET_ID, WORKSHEET_NAME } from "./../config.js";
import type {
  TransactionRow,
  TransactionStorage,
  SaveStats,
} from "../types.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";

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
    const rows: string[][] = [];
    await this.init();

    const sheet = await this.getWorkSheet();
    const stats: SaveStats = {
      name: "Google Sheets",
      replaced: 0, // TODO
      total: txns.length,
      added: 0,
      pending: 0,
      existing: 0,
    };

    for (let tx of txns) {
      if (this.existingTransactionsHashes.has(tx.hash)) {
        stats.existing++;
        continue;
      }

      if (tx.status === TransactionStatuses.Pending) {
        // TODO: Add pending rows and edit the saved row?
        stats.pending++;
        continue;
      }

      stats.added++;
      rows.push(transactionRow(tx));
    }

    if (rows.length) {
      await sheet.addRows(rows);
    }

    return stats;
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
