import { createLogger } from "./../utils/logger.js";
import {
  GoogleSpreadsheet,
  GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { parseISO, format } from "date-fns";
import { worksheetName } from "../config/ScrapeConfig.js";
import { GOOGLE_SHEET_ID, currentDate, systemName } from "../config/config.js";
import { TRANSACTION_HASH_TYPE } from "../config/SharedConfig.js";
import type {
  TransactionRow,
  TransactionStorage,
  SaveStats,
} from "../types.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { sendDeprecationMessage } from "../notifier.js";
import { normalizeCurrency } from "../utils/currency.js";

const logger = createLogger("GoogleSheetsStorage");

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
    chargedCurrency: normalizeCurrency(tx.chargedCurrency),
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

  private initPromise: null | Promise<void> = null;

  private sheet: null | GoogleSpreadsheetWorksheet = null;

  async init() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          await this.initDocAndSheet();
          await this.loadHashes();
        } catch (error) {
          logger(`Error initializing GoogleSheetsStorage: ${error.message}`);
          throw error;
        }
      })();
    }

    await this.initPromise;
  }

  canSave() {
    const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY } =
      process.env;
    return Boolean(
      GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    );
  }

  async saveTransactions(txns: Array<TransactionRow>) {
    const rows: SheetRow[] = [];
    await this.init();

    const stats = {
      name: "Google Sheets",
      table: worksheetName,
      total: txns.length,
      added: 0,
      pending: 0,
      existing: 0,
      skipped: 0,
      highlightedTransactions: {
        Added: [] as Array<TransactionRow>,
      },
    } satisfies SaveStats;

    for (let tx of txns) {
      if (TRANSACTION_HASH_TYPE === "moneyman") {
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

        if (!this.existingTransactionsHashes.has(tx.uniqueId)) {
          stats.existing++;
          stats.skipped++;
        }

        continue;
      }

      if (tx.status === TransactionStatuses.Pending) {
        stats.pending++;
        stats.skipped++;
        continue;
      }

      rows.push(transactionRow(tx));
      stats.highlightedTransactions.Added.push(tx);
    }

    if (rows.length) {
      stats.added = rows.length;
      await this.sheet?.addRows(rows);

      if (TRANSACTION_HASH_TYPE !== "moneyman") {
        sendDeprecationMessage("hashFiledChange");
      }
    }

    return stats;
  }

  private async loadHashes() {
    try {
      const rows = await this.sheet?.getRows<SheetRow>();
      for (let row of rows!) {
        this.existingTransactionsHashes.add(row.get("hash"));
      }
      logger(`${this.existingTransactionsHashes.size} hashes loaded`);
    } catch (error) {
      logger(`Error loading hashes: ${error.message}`);
      throw error;
    }
  }

  private async initDocAndSheet() {
    const {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: client_email,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: raw_private_key,
    } = process.env;

    // Replace escaped newlines with actual newlines
    const private_key = raw_private_key?.replace(/\\n/g, "\n");

    let authToken: JWT;
    try {
      authToken = new JWT({
        email: client_email,
        key: private_key,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    } catch (error) {
      logger(`Error initializing JWT: ${error.message}`);
      throw error;
    }

    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, authToken);

    try {
      await doc.loadInfo();
    } catch (error) {
      logger(`Error loading Google Spreadsheet: ${error.message}`);
      throw error;
    }

    if (!(worksheetName in doc.sheetsByTitle)) {
      logger("Creating new sheet");
      try {
        const sheet = await doc.addSheet({ title: worksheetName });
        await sheet.setHeaderRow(GoogleSheetsStorage.FileHeaders);
      } catch (error) {
        logger(`Error creating new sheet: ${error.message}`);
        throw error;
      }
    }

    this.sheet = doc.sheetsByTitle[worksheetName];
  }
}
