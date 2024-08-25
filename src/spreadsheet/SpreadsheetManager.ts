import {
  GoogleSpreadsheet,
  GoogleSpreadsheetRow,
  GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import { SHEET_NAMES } from "../config/config.js";

const logger = createLogger("notifier");

export class SpreadsheetManager {
  private document: GoogleSpreadsheet;
  private sheets: { [key: string]: GoogleSpreadsheetWorksheet } = {};

  constructor(
    private sheetId: string,
    private authToken: JWT,
  ) {
    this.document = new GoogleSpreadsheet(sheetId, authToken);
  }

  async initialize() {
    await this.document.loadInfo();
    logToPublicLog(`Loaded document: ${this.document.title}`);
    logToPublicLog(
      `Available sheets: ${Object.keys(this.document.sheetsByTitle).join(", ")}`,
    );

    // Pre-load all sheets defined in SHEET_NAMES
    for (const sheetName of Object.values(SHEET_NAMES)) {
      await this.loadSheet(sheetName);
    }
  }

  async loadSheet(sheetName: string) {
    if (!this.sheets[sheetName]) {
      this.sheets[sheetName] = this.document.sheetsByTitle[sheetName];
      if (!this.sheets[sheetName]) {
        throw new Error(`Worksheet '${sheetName}' does not exist.`);
      }
      logToPublicLog(`Worksheet '${sheetName}' accessed successfully.`);
    }
    return this.sheets[sheetName];
  }

  async getHeaders(sheetName: string): Promise<string[]> {
    const sheet = this.document.sheetsByTitle[sheetName];
    if (!sheet) throw new Error(`Sheet ${sheetName} not found`);
    await sheet.loadHeaderRow();
    return sheet.headerValues || [];
  }

  async setHeaders(sheetName: string, headers: string[]): Promise<void> {
    const sheet = this.document.sheetsByTitle[sheetName];
    if (!sheet) throw new Error(`Sheet ${sheetName} not found`);
    await sheet.setHeaderRow(headers);
  }

  async getRows(sheetName: string) {
    const sheet = await this.loadSheet(sheetName);
    const rows = await sheet.getRows();
    logToPublicLog(`Fetched ${rows.length} rows from '${sheetName}'.`);
    return rows;
  }

  async addMapping(merchantName: string, category: string) {
    const mapSheet = await this.loadSheet(SHEET_NAMES.MAP);

    await mapSheet.addRow({
      // Non-null assertion
      merchant_name: merchantName,
      category: category,
      is_dynamic: "FALSE",
    });
    logToPublicLog(
      `Added new mapping: ${merchantName} -> ${category} with is_dynamic = FALSE`,
    );
  }
}
