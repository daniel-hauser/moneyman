import { createLogger } from "./../utils/logger.js";
import {
  GoogleSpreadsheet,
  GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import { parseISO, format } from "date-fns";
import {
  GOOGLE_SHEET_ID,
  worksheetName,
  currentDate,
  systemName,
} from "./../config.js";
import type {
  TransactionRow,
  TransactionStorage,
  SaveStats,
} from "../types.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";

const logger = createLogger("GoogleSheetsStorage");

export class GoogleSheetsStorage implements TransactionStorage {
  static FileHeaders = [
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
  ];

  existingTransactionsHashes = new Set<string>();

  private initPromise: null | Promise<void> = null;

  private sheet: null | GoogleSpreadsheetWorksheet = null;

  async init() {
    if (!this.canSave){
      return;
    }
    
    // Init only once
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await this.initDocAndSheet();
        await this.loadHashes();
      })();
    }

    await this.initPromise;
  }

  canSave() {
    const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY } =
      process.env;
    return Boolean(
      GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    );
  }

  async saveTransactions(txns: Array<TransactionRow>) {
    const rows: string[][] = [];
    await this.init();

    const stats: SaveStats = {
      name: "Google Sheets",
      sheetName: worksheetName,
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
      rows.push(this.transactionRow(tx));
    }

    if (rows.length) {
      await this.sheet?.addRows(rows);
    }

    return stats;
  }

  private async loadHashes() {
    const rows = await this.sheet?.getRows();
    for (let row of rows!) {
      this.existingTransactionsHashes.add(row.hash);
    }
    logger(`${this.existingTransactionsHashes.size} hashes loaded`);
  }

  private async initDocAndSheet() {
    const doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID);

    const {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: client_email,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: private_key,
    } = process.env;

    if (client_email && private_key) {
      logger("Using ServiceAccountAuth");
      await doc.useServiceAccountAuth({
        client_email,
        private_key,
      });
    }

    await doc.loadInfo();

    if (!(worksheetName in doc.sheetsByTitle)) {
      logger("Creating new sheet");
      const sheet = await doc.addSheet({ title: worksheetName });
      await sheet.setHeaderRow(GoogleSheetsStorage.FileHeaders);
    }

    this.sheet = doc.sheetsByTitle[worksheetName];
  }

  private transactionRow(tx: TransactionRow): Array<string> {
    return [
      /* date */ format(parseISO(tx.date), "dd/MM/yyyy", {}),
      /* amount */ String(tx.chargedAmount),
      /* description */ tx.description,
      /* memo */ tx.memo ?? "",
      /* category */ tx.category ?? "",
      /* account */ tx.account,
      /* hash */ tx.hash,
      /* comment */ "",
      /* scraped at */ currentDate,
      /* scraped by */ systemName,
      /* identifier */ `${tx.identifier ?? ""}`,
    ];
  }
}
