import { GOOGLE_SHEET_ID, TELEGRAM_API_KEY, TELEGRAM_CHAT_ID, worksheetName } from './AppConfig.js';
import { GoogleSpreadsheet, GoogleSpreadsheetRow } from 'google-spreadsheet';
import { JWT, GoogleAuth } from "google-auth-library";
import { Telegraf, Markup } from 'telegraf';
import * as fileSystem from 'fs' assert { type: 'node' };
import { createLogger, logToPublicLog } from './utils/logger.js';

const logger = createLogger('notifier');

const classificationOptions = [
  "מזון וצריכה", "תחבורה", "רפואה וקוסמטיקה", "חשמל וגז", "כלבו", "אלברט", "מעבר דירה",
  "מים", "פסיכולוגית שיר", "תקשורת", "כושר", "אמזון", "ניקיון", "בילויים",
  "הלבשה והנעלה", "ציוד ביתי", "מחשבים", "מתנות", "עליאקספרס", "הריון", "פנאי ובידור",
  "צמחים", "תיירות - אוכל", "תיירות - אטרקציה", "תיירות - ביטוח", "תיירות - טיסה",
  "תיירות - לינה", "תיירות - נסיעות", "תרומות"
];

// Initialize the Telegram bot with Telegraf
const bot = TELEGRAM_API_KEY && TELEGRAM_CHAT_ID ? new Telegraf(TELEGRAM_API_KEY) : null;

logToPublicLog(
  bot
    ? 'Telegram logger initialized, status and errors will be sent'
    : 'No Telegram bot information, status and errors will not be sent',
);

let document: GoogleSpreadsheet;
let spreadsheetRows: GoogleSpreadsheetRow[] = []; // Initialize rows globally
let currentRowIndex = 0; // Initialize current row index globally

let classificationColumnName: string | undefined; // Define the classificationColumnName globally
let descriptionColumnName: string | undefined; // Define the descriptionColumnName globally

// Function to chunk an array into smaller arrays
function chunkArray(array: string[], chunkSize: number): string[][] {
  const result: string[][] = [];  // Explicitly define the type of the result array
  for (let index = 0; index < array.length; index += chunkSize) {
    result.push(array.slice(index, index + chunkSize));
  }
  return result;
}

// Split classification options into chunks of 8
const chunkedClassificationOptions: string[][] = chunkArray(classificationOptions, 8);

async function initializeDocumentAndSheet() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

  let authenticationToken: JWT | GoogleAuth<any> = new GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });

  if (clientEmail && privateKey) {
    logger('Using ServiceAccountAuth');
    authenticationToken = new JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  document = new GoogleSpreadsheet(GOOGLE_SHEET_ID, authenticationToken);
  await document.loadInfo();

  if (!(worksheetName in document.sheetsByTitle)) {
    logger('Creating new sheet');
    const sheet = await document.addSheet({ title: worksheetName });
    await sheet.setHeaderRow(['Date', 'Description', 'Amount', 'Classification']); // Example headers, adjust as needed
  }

  logger('Google Spreadsheet initialized successfully.');
}

async function accessSpreadsheet() {
  if (!document) {
    throw new Error('Google Spreadsheet is not initialized. Make sure to call `initializeDocumentAndSheet` before accessing the spreadsheet.');
  }
  await document.loadInfo(); // Load the document's information
}

async function classifyTransactions(context: any, startIndex: number = 0) {
  logger('Starting classifyTransactions...');
  logger(`Starting from index: '${startIndex}'`);

  try {
    await accessSpreadsheet();
    logger('Spreadsheet accessed successfully.');
  } catch (error) {
    logger(`Error accessing spreadsheet: ${error.message}`);
    return;
  }

  let sheet;
  try {
    sheet = document.sheetsByTitle[worksheetName];
    if (!sheet) {
      throw new Error(`Worksheet '${worksheetName}' does not exist.`);
    }
    logger(`Worksheet '${worksheetName}' accessed successfully.`);
  } catch (error) {
    logger(`Error accessing worksheet '${worksheetName}': ${error.message}`);
    return;
  }

  let mapSheet;
  try {
    mapSheet = document.sheetsByTitle["map"];
    if (!mapSheet) {
      throw new Error("Map worksheet 'map' does not exist.");
    }
    logger(`Map worksheet 'map' accessed successfully.`);
  } catch (error) {
    logger(`Error accessing 'map' worksheet: ${error.message}`);
    return;
  }

  try {
    await sheet.loadHeaderRow();
    logger('Header row loaded successfully.');
  } catch (error) {
    logger(`Error loading header row: ${error.message}`);
    return;
  }

  const headerRow = sheet.headerValues.map(header => header.trim().toLowerCase());

  descriptionColumnName = headerRow.find(header => header === 'description');
  classificationColumnName = headerRow.find(header => header === 'classification') || 'classification';

  if (!descriptionColumnName || !classificationColumnName) {
    logger('Required columns are missing. Ensure the spreadsheet has proper headers.');
    return;
  }

  if (!headerRow.includes('classification')) {
    try {
      headerRow.push('classification');
      await sheet.setHeaderRow(headerRow);
      logger('Added "classification" column to header row.');
    } catch (error) {
      logger(`Error adding 'classification' column: ${error.message}`);
      return;
    }
  }

  try {
    spreadsheetRows = await sheet.getRows();
    logger(`Retrieved ${spreadsheetRows.length} rows from the sheet.`);
  } catch (error) {
    logger(`Error retrieving rows: ${error.message}`);
    return;
  }

  let mapRows;
  try {
    mapRows = await mapSheet.getRows();
    logger(`Retrieved ${mapRows.length} rows from the 'map' sheet.`);
  } catch (error) {
    logger(`Error retrieving rows from 'map' sheet: ${error.message}`);
    return;
  }

  // Create a mapping from merchant_name to category
  const merchantCategoryMap: { [key: string]: string } = {};
  mapRows.forEach(mapRow => {
    const merchantName = mapRow["merchant_name"]?.trim() || ""; // Default to empty string if undefined
    const category = mapRow["category"]?.trim() || ""; // Default to empty string if undefined
    if (merchantName && category) {
      merchantCategoryMap[merchantName.toLowerCase()] = category;
    }
  });

  // Track new mappings for later addition to the "map" sheet
  const newMappings: { merchantName: string; category: string }[] = [];

  // Update the "Classification" column based on the "map" sheet
  for (let index = startIndex; index < spreadsheetRows.length; index++) {
    const row = spreadsheetRows[index];
    const description = row.get(descriptionColumnName!)?.trim().toLowerCase() || ""; // Non-null assertion or default value

    if (description && merchantCategoryMap[description]) {
      row.set(classificationColumnName!, merchantCategoryMap[description]); // Use non-null assertion
      try {
        await row.save();
        logger(`Row ${index + 1}: Automatically classified as '${merchantCategoryMap[description]}' based on the 'map' sheet.`);
      } catch (error) {
        logger(`Error saving automatic classification for row ${index + 1}: ${error.message}`);
      }
    }
  }

  // Proceed with manual classification for unclassified transactions
  for (let index = startIndex; index < spreadsheetRows.length; index++) {
    const row = spreadsheetRows[index];

    if (!row.get(classificationColumnName!)) {  // Non-null assertion for classificationColumnName
      const description = row.get(descriptionColumnName!) || 'No Description'; // Non-null assertion for descriptionColumnName
      logger(`Row ${index + 1} has no 'Classification'. Description: ${description}`);

      currentRowIndex = index; // Update the global index

      if (bot) {
        // Send classification options in chunks (pagination)
        for (const chunk of chunkedClassificationOptions) {
          await context.reply(`Classify the transaction: ${description}`, Markup.inlineKeyboard(
            chunk.map(option => Markup.button.callback(option, `classify_${index}_${option}`))
          ));
        }

        bot.action(/^classify_(\d+)_(.+)$/, async (ctxAction) => {
          const rowIndex = parseInt(ctxAction.match[1], 10);
          const selectedOption = ctxAction.match[2];

          const row = spreadsheetRows[rowIndex];
          if (!row) {
            logger(`Row ${rowIndex + 1} not found.`);
            await ctxAction.reply('Row not found.');
            return;
          }

          row.set(classificationColumnName!, selectedOption);

          // Save the manual classification
          try {
            await row.save();
            logger(`Row ${rowIndex + 1} classified as: ${selectedOption}`);
            await ctxAction.reply(`Transaction classified as: ${selectedOption}`);
            ctxAction.answerCbQuery();

            // Add to new mappings if not already in the map
            const description = row.get(descriptionColumnName!)?.trim().toLowerCase() || "";
            if (description && !merchantCategoryMap[description]) {
              newMappings.push({ merchantName: description, category: selectedOption });

              // Immediately add the new mapping to the "map" sheet with is_dynamic = FALSE
              try {
                await mapSheet.addRow({
                  merchant_name: description,
                  category: selectedOption,
                  is_dynamic: "FALSE", // Set is_dynamic to FALSE
                });
                logger(`Added new mapping: ${description} -> ${selectedOption} with is_dynamic = FALSE`);
              } catch (error) {
                logger(`Error adding new mapping for merchant: ${description}. Error: ${error.message}`);
              }
            }

          } catch (error) {
            logger(`Error saving classification for row ${rowIndex + 1}: ${error.message}`);
          }

          // Continue to the next unclassified transaction
          currentRowIndex = rowIndex + 1;
          if (currentRowIndex < spreadsheetRows.length) {
            classifyTransactions(ctxAction, currentRowIndex);
          } else {
            logger('All rows processed.');
            await ctxAction.reply('All transactions have been classified.');
          }
        });

        return; // Exit to wait for user classification; execution will resume after selection
      } else {
        logger('Bot is not initialized. Cannot proceed with classification.');
        return;
      }
    }
  }

  logger('Finished classifyTransactions. No rows need classification.');
}


if (bot) {
  bot.start((context) => context.reply('Welcome! Use /classify to start classifying transactions.'));
  bot.command('classify', (context) => {
    classifyTransactions(context);
    context.reply('Starting classification...');
  });

  bot.launch().then(() => {
    logger('Bot launched successfully.');
    console.log('Bot is running...');
  }).catch((error) => {
    logger(`Failed to launch the bot: ${error.message}`);
  });

  // Prevent Node.js process from exiting
  process.on('SIGINT', () => {
    bot.stop('SIGINT');
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    bot.stop('SIGTERM');
    process.exit(0);
  });
} else {
  logger('Bot is not initialized. Actions cannot be processed.');
}

async function main() {
  await initializeDocumentAndSheet();
}

main().catch(console.error);
