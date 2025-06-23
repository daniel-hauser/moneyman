import assert from "node:assert";
import { createLogger } from "../../utils/logger.js";
import {
  GoogleSpreadsheet,
  GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import { GoogleAuth } from "google-auth-library";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { sendDeprecationMessage, sendError } from "../notifier.js";
import { createSaveStats } from "../saveStats.js";
import { tableRow } from "../transactionTableRow.js";
import type { MoneymanConfig } from "../../config.js";

const logger = createLogger("GoogleSheetsStorage");

export class GoogleSheetsStorage implements TransactionStorage {
  private worksheetName: string;

  constructor(private config: MoneymanConfig) {
    this.worksheetName =
      this.config.storage.googleSheets?.worksheetName || "_moneyman";
  }
  canSave() {
    return Boolean(this.config.storage.googleSheets);
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    const [doc] = await Promise.all([this.getDoc(), onProgress("Getting doc")]);

    await onProgress(`Getting sheet ${this.worksheetName}`);
    const sheet = doc.sheetsByTitle[this.worksheetName];
    assert(sheet, `Sheet ${this.worksheetName} not found`);

    // Load header row to check if raw column exists
    await sheet.loadHeaderRow();
    const hasRawColumn = sheet.headerValues.includes("raw");

    const existingHashes = await this.loadHashes(sheet, onProgress);

    const stats = createSaveStats("Google Sheets", this.worksheetName, txns, {
      highlightedTransactions: {
        Added: [] as Array<TransactionRow>,
      },
    });

    const newTxns = txns.filter((tx) => {
      if (this.config.options.scraping.transactionHashType === "moneyman") {
        // Use the new uniqueId as the unique identifier for the transactions if the hash type is moneyman
        if (existingHashes.has(tx.uniqueId)) {
          stats.existing++;
          return false;
        }
      }

      if (existingHashes.has(tx.hash)) {
        if (this.config.options.scraping.transactionHashType === "moneyman") {
          logger(`Skipping, old hash ${tx.hash} is already in the sheet`);
        }

        // To avoid double counting, skip if the new hash is already in the sheet
        if (!existingHashes.has(tx.uniqueId)) {
          stats.existing++;
        }

        return false;
      }

      return tx.status !== TransactionStatuses.Pending;
    });

    const rows = newTxns.map((tx) => tableRow(tx, hasRawColumn));
    if (rows.length) {
      try {
        stats.highlightedTransactions.Added.push(...newTxns);
        stats.added = rows.length;
        await Promise.all([
          onProgress(`Saving ${rows.length} rows`),
          sheet.addRows(rows),
        ]);
        if (this.config.options.scraping.transactionHashType !== "moneyman") {
          sendDeprecationMessage("hashFiledChange");
        }
      } catch (e) {
        logger("Error saving transactions", e);
        sendError(e, "GoogleSheetsStorage::saveTransactions");
        const hashes = await this.loadHashes(sheet, onProgress);
        const notSaved = newTxns.filter(
          ({ hash, uniqueId }) => !hashes.has(hash) && !hashes.has(uniqueId),
        );
        stats.added -= notSaved.length;
        stats.otherSkipped = notSaved.length;
      }
    }

    return stats;
  }

  private async getDoc() {
    const googleSheetsConfig = this.config.storage.googleSheets;
    assert(googleSheetsConfig, "Google Sheets configuration not found");

    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      credentials: {
        client_email: googleSheetsConfig.serviceAccountEmail,
        private_key: googleSheetsConfig.serviceAccountPrivateKey,
      },
    });
    const authClient = await auth.getClient();
    const doc = new GoogleSpreadsheet(googleSheetsConfig.sheetId, authClient);
    await doc.loadInfo();
    return doc;
  }

  /**
   * Load hashes from the "hash" column, assuming the first row is a header row
   */
  private async loadHashes(
    sheet: GoogleSpreadsheetWorksheet,
    onProgress: (status: string) => Promise<void>,
  ) {
    const column = sheet.headerValues.indexOf("hash");
    assert(column !== -1, "Hash column not found");
    assert(column < 26, "Currently only supports single letter columns");

    const columnLetter = String.fromCharCode(65 + column);
    const range = `${columnLetter}2:${columnLetter}`;

    const [columns] = await Promise.all([
      sheet.getCellsInRange(range, {
        majorDimension: "COLUMNS",
      }),
      onProgress(`Loading hashes (${range})`),
    ]);

    return Array.isArray(columns)
      ? new Set(columns[0] as string[])
      : new Set<string>();
  }
}
