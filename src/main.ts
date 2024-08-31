import { AutoClassifier } from "./bot/AutoClassifier.js";
import { ManualClassifier } from "./bot/ManualClassifier.js";
import { SpreadsheetManager } from "./spreadsheet/SpreadsheetManager.js";
import { JWT } from "google-auth-library";
import { createLogger, logToPublicLog } from "./utils/logger.js";
import { send } from "./notifier.js";
import { Telegraf } from "telegraf";
import {
  TELEGRAM_API_KEY,
  TELEGRAM_CHAT_ID,
  GOOGLE_SHEET_ID,
} from "./config/ClassifyConfig.js";
import { classificationOptions } from "./config/config.js";

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
    await send(
      "Application is starting... Preparing to classify transactions if available.",
    );

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

    logToPublicLog("Initializing Telegram Bot...");
    const bot = new Telegraf(TELEGRAM_API_KEY);

    logToPublicLog("Creating AutoClassifier...");
    const autoClassifier = new AutoClassifier(spreadsheetManager);

    logToPublicLog("Creating ManualClassifier...");
    const manualClassifier = new ManualClassifier(
      bot,
      classificationOptions,
      spreadsheetManager,
    );

    logToPublicLog("Starting auto-classification...");
    const classifiedCount = await autoClassifier.classifyTransactions("Sheet5");

    // Check if there are still unclassified rows
    const rows = await spreadsheetManager.getRows("Sheet5");
    const unclassifiedRows = rows.filter((row) => !row.get("classification"));

    if (unclassifiedRows.length > 0) {
      logToPublicLog(
        `Found ${unclassifiedRows.length} unclassified rows. Waiting for user to start manual classification...`,
      );
    } else {
      logToPublicLog(
        "All rows classified during auto-classification. No manual classification needed.",
      );
    }

    logToPublicLog("Starting bot...");
    await send("Bot is starting... You can now classify transactions.");

    manualClassifier.startBot(); // Start the bot and listen for commands

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
