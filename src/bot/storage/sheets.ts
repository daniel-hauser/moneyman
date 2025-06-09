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

const logger = createLogger("GoogleSheetsStorage");

const {
  WORKSHEET_NAME,
  GOOGLE_SHEET_ID = "",
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  TRANSACTION_HASH_TYPE,
} = process.env;

const worksheetName = WORKSHEET_NAME || "_moneyman";

/**
 * Retry function for Google API operations with exponential backoff
 * Handles transient errors like 503 "Service is currently unavailable"
 */
async function retryGoogleApiOperation<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Check if it's a retryable error (503 or other transient errors)
      const isRetryable =
        error &&
        ((error as any).status === 503 ||
          (error as any).code === 503 ||
          (error as any).message?.includes("503") ||
          (error as any).message?.includes("currently unavailable") ||
          (error as any).message?.includes("temporarily unavailable") ||
          (error as any).message?.includes("Service Unavailable"));

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      logger(
        `${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms: ${error.message}`,
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // This should never be reached, but TypeScript needs it
  throw (
    lastError ||
    new Error(`${operationName} failed after ${maxRetries} attempts`)
  );
}

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

    await onProgress("Getting sheet");
    const sheet = doc.sheetsByTitle[worksheetName];
    if (!sheet) {
      throw new Error(`Sheet ${worksheetName} not found`);
    }

    const [existingHashes] = await Promise.all([
      this.loadHashes(sheet),
      onProgress("Loading hashes"),
    ]);

    const stats = createSaveStats("Google Sheets", worksheetName, txns, {
      highlightedTransactions: {
        Added: [] as Array<TransactionRow>,
      },
    });

    const rows: TableRow[] = [];
    for (let tx of txns) {
      if (TRANSACTION_HASH_TYPE === "moneyman") {
        // Use the new uniqueId as the unique identifier for the transactions if the hash type is moneyman
        if (existingHashes.has(tx.uniqueId)) {
          stats.existing++;
          continue;
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

        continue;
      }

      if (tx.status === TransactionStatuses.Pending) {
        continue;
      }

      rows.push(tableRow(tx));
      stats.highlightedTransactions.Added.push(tx);
    }

    if (rows.length) {
      stats.added = rows.length;
      await Promise.all([
        onProgress("Saving"),
        retryGoogleApiOperation(() => sheet.addRows(rows), "sheet.addRows"),
      ]);
      if (TRANSACTION_HASH_TYPE !== "moneyman") {
        sendDeprecationMessage("hashFiledChange");
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
    await retryGoogleApiOperation(() => doc.loadInfo(), "doc.loadInfo");
    return doc;
  }

  /**
   * Load hashes from the "hash" column, assuming the first row is a header row
   */
  private async loadHashes(sheet: GoogleSpreadsheetWorksheet) {
    await retryGoogleApiOperation(
      () => sheet.loadHeaderRow(),
      "sheet.loadHeaderRow",
    );

    const hashColumnNumber = sheet.headerValues.indexOf("hash");
    if (hashColumnNumber === -1) {
      throw new Error("Hash column not found");
    }

    if (hashColumnNumber >= 26) {
      throw new Error("Currently only supports single letter columns");
    }

    const columnLetter = String.fromCharCode(65 + hashColumnNumber);
    const range = `${columnLetter}2:${columnLetter}`;

    const columns = await retryGoogleApiOperation(
      () =>
        sheet.getCellsInRange(range, {
          majorDimension: "COLUMNS",
        }),
      "sheet.getCellsInRange",
    );

    if (Array.isArray(columns)) {
      return new Set(columns[0] as string[]);
    }

    throw new Error("loadHashesBetter: getCellsInRange returned non-array");
  }
}
