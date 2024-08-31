// commonClassifier.ts

import { SpreadsheetManager } from "../spreadsheet/SpreadsheetManager.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("commonClassifier");

export const buildMerchantCategoryMap = async (
  spreadsheetManager: SpreadsheetManager,
  sheetName: string,
) => {
  const rows = await spreadsheetManager.getRows(sheetName);
  const merchantCategoryMap: { [key: string]: string } = {};

  rows.forEach((row) => {
    const merchantName = row.get("merchant_name")?.trim().toLowerCase() || "";
    const category = row.get("category")?.trim() || "";
    if (merchantName && category) {
      merchantCategoryMap[merchantName] = category;
    }
  });

  logger(
    `Built merchant category map with ${Object.keys(merchantCategoryMap).length} entries.`,
  );
  return merchantCategoryMap;
};

export const saveRow = async (row: any) => {
  await row.save();
  logger(`Row saved: ${row}`);
};
