// AutoClassifier.ts

import { SpreadsheetManager } from "../spreadsheet/SpreadsheetManager.js";
import { createLogger } from "../utils/logger.js";
import { buildMerchantCategoryMap, saveRow } from "./CommonClassifier.js";

const logger = createLogger("AutoClassifier");

export class AutoClassifier {
  private spreadsheetManager: SpreadsheetManager;

  constructor(spreadsheetManager: SpreadsheetManager) {
    this.spreadsheetManager = spreadsheetManager;
  }

  async classifyTransactions(sheetName: string) {
    try {
      logger("Auto-classification process started...");

      const rows = await this.spreadsheetManager.getRows(sheetName);
      const merchantCategoryMap = await buildMerchantCategoryMap(
        this.spreadsheetManager,
        "map",
      );

      let classifiedCount = 0;

      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const description = row.get("description")?.trim().toLowerCase() || "";

        logger(`Processing row ${index + 1}: ${description}`);

        if (description && merchantCategoryMap[description]) {
          const category = merchantCategoryMap[description];
          row.set("classification", category);
          await saveRow(row);
          classifiedCount++;
          logger(`Row ${index + 1} classified as ${category}.`);
        } else {
          logger(`Row ${index + 1} could not be auto-classified.`);
        }
      }

      logger(
        `Auto-classification completed. Classified ${classifiedCount} out of ${rows.length} rows.`,
      );
      return classifiedCount;
    } catch (error) {
      logger(`Error in classifyTransactions: ${error.message}`);
      throw error;
    }
  }
}
