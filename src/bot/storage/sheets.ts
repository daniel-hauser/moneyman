import { retry } from "async";
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
import { TableRow, tableRow, TableHeaders } from "../transactionTableRow.js";

const logger = createLogger("GoogleSheetsStorage");

const {
  WORKSHEET_NAME = "_moneyman",
  GOOGLE_SHEET_ID = "",
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  TRANSACTION_HASH_TYPE,
} = process.env;

export class GoogleSheetsStorage implements TransactionStorage {
  canSave() {
    return Boolean(
      GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    );
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    const [doc] = await Promise.all([this.getDoc(), onProgress("Getting doc")]);

    const sheet = await retry(3, async () => {
      await onProgress("Getting sheet");
      if (doc.sheetsByTitle[WORKSHEET_NAME]) {
        return doc.sheetsByTitle[WORKSHEET_NAME];
      }

      const [sheet] = await Promise.all([
        this.addSheet(doc),
        onProgress("Adding sheet"),
      ]);

      if (!sheet) {
        throw new Error("sheet not found");
      }

      return sheet;
    });

    const [existingHashes] = await Promise.all([
      this.loadHashes(sheet),
      onProgress("Loading hashes"),
    ]);

    const stats = createSaveStats("Google Sheets", WORKSHEET_NAME, txns, {
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
          stats.skipped++;
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
      if (TRANSACTION_HASH_TYPE !== "moneyman") {
        sendDeprecationMessage("hashFiledChange");
      }
    }

    return stats;
  }

  private async getDoc() {
    const {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: client_email,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: private_key,
    } = process.env;

    const credentials = { client_email, private_key };
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      credentials: client_email && private_key ? credentials : undefined,
    });

    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, auth);
    await doc.loadInfo();
    return doc;
  }

  private async addSheet(doc: GoogleSpreadsheet) {
    logger("Creating new sheet");
    return doc.addSheet({
      title: WORKSHEET_NAME,
      headerValues: [...TableHeaders],
    });
  }

  private async loadHashes(sheet: GoogleSpreadsheetWorksheet) {
    const rows = await sheet.getRows<TableRow>();
    if (!rows) {
      throw new Error(`loadHashes: getRows returned ${rows}`);
    }

    const existingHashes = new Set(rows.map((row) => row.get("hash")));
    logger(`${existingHashes.size} hashes loaded`);

    return existingHashes;
  }
}
