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

const logger = createLogger("GoogleSheetsStorage");

const {
  WORKSHEET_NAME,
  GOOGLE_SHEET_ID = "",
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  TRANSACTION_HASH_TYPE,
} = process.env;

const worksheetName = WORKSHEET_NAME || "_moneyman";

export class GoogleSheetsStorage implements TransactionStorage {
  canSave() {
    return Boolean(
      GOOGLE_SHEET_ID &&
        GOOGLE_SERVICE_ACCOUNT_EMAIL &&
        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    );
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    const [doc] = await Promise.all([this.getDoc(), onProgress("Getting doc")]);

    await onProgress(`Getting sheet ${worksheetName}`);
    const sheet = doc.sheetsByTitle[worksheetName];
    assert(sheet, `Sheet ${worksheetName} not found`);

    // Load header row to check if raw column exists
    await sheet.loadHeaderRow();
    const hasRawColumn = sheet.headerValues.includes("raw");

    const existingHashes = await this.loadHashes(sheet, onProgress);

    const stats = createSaveStats("Google Sheets", worksheetName, txns, {
      highlightedTransactions: {
        Added: [] as Array<TransactionRow>,
      },
    });

    const newTxns = txns.filter((tx) => {
      if (TRANSACTION_HASH_TYPE === "moneyman") {
        // Use the new uniqueId as the unique identifier for the transactions if the hash type is moneyman
        if (existingHashes.has(tx.uniqueId)) {
          stats.existing++;
          return false;
        }
      }

      if (existingHashes.has(tx.hash)) {
        if (TRANSACTION_HASH_TYPE === "moneyman") {
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
        if (TRANSACTION_HASH_TYPE !== "moneyman") {
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
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      credentials: {
        client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      },
    });

    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, auth);
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
