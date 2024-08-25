import { SpreadsheetManager } from "./spreadsheet/SpreadsheetManager.js";
import { TransactionClassifier } from "./bot/TransactionClassifier.js";
import {
  TELEGRAM_API_KEY,
  TELEGRAM_CHAT_ID,
  GOOGLE_SHEET_ID,
} from "./config/ClassifyConfig.js";
import { classificationOptions } from "./config/config.js";
import { JWT } from "google-auth-library";
import { createLogger, logToPublicLog } from "./utils/logger.js";

const logger = createLogger("main");

function validateEnvVariables() {
  const requiredVars = [
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
    "GOOGLE_SHEET_ID",
    "TELEGRAM_API_KEY",
    "TELEGRAM_CHAT_ID",
  ];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      throw new Error(`Missing required environment variable: ${varName}`);
    }
  }
}

async function main() {
  try {
    logToPublicLog("Validating environment variables...");
    validateEnvVariables();

    logToPublicLog("Starting application...");

    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
      /\\n/g,
      "\n",
    );

    if (!clientEmail || !privateKey) {
      throw new Error("Missing Google Service Account credentials");
    }

    logToPublicLog("Initializing JWT...");
    const authToken = new JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    logToPublicLog("Creating SpreadsheetManager...");
    const spreadsheetManager = new SpreadsheetManager(
      GOOGLE_SHEET_ID,
      authToken,
    );

    logToPublicLog("Initializing SpreadsheetManager...");
    await spreadsheetManager.initialize();

    logToPublicLog("Creating TransactionClassifier...");
    const transactionClassifier = new TransactionClassifier(
      spreadsheetManager,
      TELEGRAM_API_KEY,
      TELEGRAM_CHAT_ID,
      classificationOptions,
    );

    logToPublicLog("Starting bot...");
    transactionClassifier.startBot();

    logToPublicLog("Application started successfully.");
  } catch (error) {
    logToPublicLog(`Error in main: ${error.message}`);
    console.error("An error occurred:", error);
  }
}

main().catch((error) => {
  logToPublicLog(`Unhandled error in main: ${error.message}`);
  console.error("An unhandled error occurred:", error);
});
