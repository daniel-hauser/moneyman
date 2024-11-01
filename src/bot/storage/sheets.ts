import { createLogger } from "../../utils/logger.js";
import {
  GoogleSpreadsheet,
  GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import { GoogleAuth, JWT } from "google-auth-library";
import { format, parseISO } from "date-fns";
import { systemName } from "../../config.js";
import type { TransactionRow, TransactionStorage } from "../../types.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { sendDeprecationMessage } from "../notifier.js";
import { normalizeCurrency } from "../../utils/currency.js";
import { createSaveStats } from "../saveStats.js";

const logger = createLogger("GoogleSheetsStorage");

const {
  WORKSHEET_NAME = "_moneyman",
  GOOGLE_SHEET_ID = "",
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
  TRANSACTION_HASH_TYPE,
} = process.env;

const currentDate = format(Date.now(), "yyyy-MM-dd");

export type SheetRow = {
  date: string;
  amount: number;
  description: string;
  memo: string;
  category: string;
  account: string;
  hash: string;
  comment: string;
  "scraped at": string;
  "scraped by": string;
  identifier: string;
  chargedCurrency: string;
};

export function transactionRow(tx: TransactionRow): SheetRow {
  return {
    date: format(parseISO(tx.date), "dd/MM/yyyy", {}),
    amount: tx.chargedAmount,
    description: tx.description,
    memo: tx.memo ?? "",
    category: tx.category ?? "",
    account: tx.account,
    hash: TRANSACTION_HASH_TYPE === "moneyman" ? tx.uniqueId : tx.hash,
    comment: "",
    "scraped at": currentDate,
    "scraped by": systemName,
    identifier: `${tx.identifier ?? ""}`,
    // Assuming the transaction is not pending, so we can use the original currency as the charged currency
    chargedCurrency:
      normalizeCurrency(tx.chargedCurrency) ||
      normalizeCurrency(tx.originalCurrency),
  };
}

export class GoogleSheetsStorage implements TransactionStorage {
  static FileHeaders: Array<keyof SheetRow> = [
    "date",
    "amount",
    "description",
    "memo",
    "category",
    "account",
    "hash",
    "comment",
    "scraped at",
    "scraped by",
    "identifier",
    "chargedCurrency",
  ];

  existingTransactionsHashes = new Set<string>();

  private sheet: null | GoogleSpreadsheetWorksheet = null;

  canSave() {
    return Boolean(
      GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    );
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    const rows: SheetRow[] = [];
    await Promise.all([onProgress("Initializing"), this.initDocAndSheet()]);
    await Promise.all([onProgress("Loading hashes"), this.loadHashes()]);

    const stats = createSaveStats("Google Sheets", WORKSHEET_NAME, txns, {
      highlightedTransactions: {
        Added: [] as Array<TransactionRow>,
      },
    });

    for (let tx of txns) {
      if (TRANSACTION_HASH_TYPE === "moneyman") {
        // Use the new uniqueId as the unique identifier for the transactions if the hash type is moneyman
        if (this.existingTransactionsHashes.has(tx.uniqueId)) {
          stats.existing++;
          stats.skipped++;
          continue;
        }
      }

      if (this.existingTransactionsHashes.has(tx.hash)) {
        if (TRANSACTION_HASH_TYPE === "moneyman") {
          logger(`Skipping, old hash ${tx.hash} is already in the sheet`);
        }

        // To avoid double counting, skip if the new hash is already in the sheet
        if (!this.existingTransactionsHashes.has(tx.uniqueId)) {
          stats.existing++;
          stats.skipped++;
        }

        continue;
      }

      if (tx.status === TransactionStatuses.Pending) {
        stats.skipped++;
        continue;
      }

      rows.push(transactionRow(tx));
      stats.highlightedTransactions.Added.push(tx);
    }

    if (rows.length) {
      stats.added = rows.length;
      await Promise.all([onProgress("Saving"), this.sheet?.addRows(rows)]);
      if (TRANSACTION_HASH_TYPE !== "moneyman") {
        sendDeprecationMessage("hashFiledChange");
      }
    }

    return stats;
  }

  private async loadHashes() {
    const rows = await this.sheet?.getRows<SheetRow>();
    for (let row of rows!) {
      this.existingTransactionsHashes.add(row.get("hash"));
    }
    logger(`${this.existingTransactionsHashes.size} hashes loaded`);
  }

  private async initDocAndSheet() {
    const {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: client_email,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: private_key,
    } = process.env;

    // By default, try to automatically get credentials
    // (maybe we're running in Google Cloud, who knows)
    let authToken: JWT | GoogleAuth<any> = new GoogleAuth({
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file",
      ],
    });
    if (client_email && private_key) {
      logger("Using ServiceAccountAuth");
      authToken = new JWT({
        email: client_email,
        key: private_key,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    }
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, authToken);

    await doc.loadInfo();

    if (!(WORKSHEET_NAME in doc.sheetsByTitle)) {
      logger("Creating new sheet");
      const sheet = await doc.addSheet({ title: WORKSHEET_NAME });
      await sheet.setHeaderRow(GoogleSheetsStorage.FileHeaders);
      await doc.loadInfo();
    }

    this.sheet = doc.sheetsByTitle[WORKSHEET_NAME];
  }
}
