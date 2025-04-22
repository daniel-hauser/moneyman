import { createLogger } from "../../utils/logger.js";
import {
  GoogleSpreadsheet,
  GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import { GoogleAuth } from "google-auth-library";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { sendDeprecationMessage } from "../notifier.js";
import { createSaveStats } from "../saveStats.js";
import { TableRow, tableRow } from "../transactionTableRow.js";
import { GoogleSheetsConfigType } from "../../config/storage.schema.js";

const logger = createLogger("GoogleSheetsStorage");

export class GoogleSheetsStorage implements TransactionStorage {
  private transactionHashType: string;

  constructor(
    private config: GoogleSheetsConfigType,
    private globalConfig: { transactionHashType: string },
  ) {
    this.transactionHashType = globalConfig.transactionHashType;
  }

  canSave() {
    return Boolean(
      this.config.sheetId &&
        this.config.serviceAccountEmail &&
        this.config.serviceAccountPrivateKey,
    );
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    const [doc] = await Promise.all([this.getDoc(), onProgress("Getting doc")]);

    await onProgress("Getting sheet");
    const sheet = doc.sheetsByTitle[this.config.worksheetName];
    if (!sheet) {
      throw new Error(`Sheet ${this.config.worksheetName} not found`);
    }

    const [existingHashes] = await Promise.all([
      this.loadHashes(sheet),
      onProgress("Loading hashes"),
    ]);

    const stats = createSaveStats(
      "Google Sheets",
      this.config.worksheetName,
      txns,
      {
        highlightedTransactions: {
          Added: [] as Array<TransactionRow>,
        },
      },
    );

    const rows: TableRow[] = [];
    for (let tx of txns) {
      if (this.transactionHashType === "moneyman") {
        // Use the new uniqueId as the unique identifier for the transactions if the hash type is moneyman
        if (existingHashes.has(tx.uniqueId)) {
          stats.existing++;
          stats.skipped++;
          continue;
        }
      }

      if (existingHashes.has(tx.hash)) {
        if (this.transactionHashType === "moneyman") {
          logger(`Skipping, old hash ${tx.hash} is already in the sheet`);
        }

        // To avoid double counting, skip if the new hash is already in the sheet
        if (!existingHashes.has(tx.uniqueId)) {
          stats.existing++;
          stats.skipped++;
        }

        continue;
      }

      if (tx.status === TransactionStatuses.Pending) {
        stats.skipped++;
        continue;
      }

      rows.push(tableRow(tx));
      stats.highlightedTransactions.Added.push(tx);
    }

    if (rows.length) {
      stats.added = rows.length;
      await Promise.all([onProgress("Saving"), sheet.addRows(rows)]);
      if (this.transactionHashType !== "moneyman") {
        sendDeprecationMessage("hashFiledChange");
      }
    }

    return stats;
  }

  private async getDoc() {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      credentials: {
        client_email: this.config.serviceAccountEmail,
        private_key: this.config.serviceAccountPrivateKey,
      },
    });

    const doc = new GoogleSpreadsheet(this.config.sheetId, auth);
    await doc.loadInfo();
    return doc;
  }

  /**
   * Load hashes from the "hash" column, assuming the first row is a header row
   */
  private async loadHashes(sheet: GoogleSpreadsheetWorksheet) {
    await sheet.loadHeaderRow();
    const hashColumnNumber = sheet.headerValues.indexOf("hash");
    if (hashColumnNumber === -1) {
      throw new Error("Hash column not found");
    }

    if (hashColumnNumber >= 26) {
      throw new Error("Currently only supports single letter columns");
    }

    const columnLetter = String.fromCharCode(65 + hashColumnNumber);
    const range = `${columnLetter}2:${columnLetter}`;

    const columns = await sheet.getCellsInRange(range, {
      majorDimension: "COLUMNS",
    });

    if (Array.isArray(columns)) {
      return new Set(columns[0] as string[]);
    }

    throw new Error("loadHashesBetter: getCellsInRange returned non-array");
  }
}
