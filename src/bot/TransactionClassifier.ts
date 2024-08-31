import { Telegraf, Markup } from "telegraf";
import { SpreadsheetManager } from "../spreadsheet/SpreadsheetManager";
import { createLogger, logToPublicLog } from "../utils/logger.js";
import { ClassificationOption, botTimeoutMinutes } from "../config/config.js";

const logger = createLogger("notifier");

export class TransactionClassifier {
  private bot: Telegraf | null;
  private classificationOptions: ClassificationOption[];
  private chunkedClassificationOptions: string[][];
  private inactivityTimeout: NodeJS.Timeout | null = null;

  constructor(
    private spreadsheetManager: SpreadsheetManager,
    telegramApiKey: string,
    telegramChatId: string,
    classificationOptions: ClassificationOption[],
  ) {
    this.classificationOptions = classificationOptions;
    this.chunkedClassificationOptions = this.chunkArray(
      classificationOptions.map((option) => option.emoji),
      8,
    );
    this.bot =
      telegramApiKey && telegramChatId ? new Telegraf(telegramApiKey) : null;
  }

  chunkArray(array: string[], chunkSize: number): string[][] {
    const result: string[][] = [];
    for (let index = 0; index < array.length; index += chunkSize) {
      result.push(array.slice(index, index + chunkSize));
    }
    return result;
  }

  startBot() {
    if (!this.bot) {
      logToPublicLog("Bot is not initialized. Actions cannot be processed.");
      return;
    }

    logToPublicLog("Launching bot...");
    this.bot
      .launch()
      .then(async () => {
        logToPublicLog("Bot launched successfully.");
        logToPublicLog("Starting auto-classification...");
        await this.autoClassifyTransactions(); // Auto-classify on launch
        this.resetInactivityTimeout(); // Start inactivity timer on launch
      })
      .catch((error) => {
        logToPublicLog(`Failed to launch the bot: ${error.message}`);
      });

    // Listen for /classify command to start manual classification
    this.bot.command("classify", async (context) => {
      this.resetInactivityTimeout(); // Reset timeout on /classify
      const rows = await this.spreadsheetManager.getRows("Sheet5"); // Ensure rows are fetched again
      await this.promptUserForClassification(context, rows, 0); // Start manual classification
    });

    // Register action handlers only once
    this.registerActionHandlers();

    process.on("SIGINT", () => {
      this.bot?.stop("SIGINT");
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      this.bot?.stop("SIGTERM");
      process.exit(0);
    });
  }

  private registerActionHandlers() {
    // Register handlers for classification and split actions
    this.bot?.action(/^classify_(\d+)_(.+)$/, async (ctxAction) => {
      this.resetInactivityTimeout(); // Reset timeout on action
      const rowIndex = parseInt(ctxAction.match[1], 10);
      const selectedEmoji = ctxAction.match[2];

      const selectedOption = this.classificationOptions.find(
        (option) => option.emoji === selectedEmoji,
      );

      if (selectedOption) {
        await this.handleClassification(ctxAction, rowIndex, selectedOption);
      } else {
        await ctxAction.reply("Error: Classification option not found.");
        logToPublicLog(
          `Error: Classification option for emoji ${selectedEmoji} not found.`,
        );
      }
    });

    this.bot?.action(/^split_(\d+)$/, async (ctxAction) => {
      this.resetInactivityTimeout(); // Reset timeout on action
      const rowIndex = parseInt(ctxAction.match[1], 10);
      await this.handleSplitTransaction(ctxAction, rowIndex);
    });
  }

  private resetInactivityTimeout() {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
    }
    this.inactivityTimeout = setTimeout(
      () => {
        logToPublicLog(
          `No response received within ${botTimeoutMinutes} minutes. Shutting down.`,
        );
        process.exit(0);
      },
      botTimeoutMinutes * 60 * 1000,
    );
    logToPublicLog(`Inactivity timeout reset to ${botTimeoutMinutes} minutes.`);
  }

  private async handleClassification(
    ctxAction: any,
    rowIndex: number,
    selectedOption: ClassificationOption,
  ) {
    const rows = await this.spreadsheetManager.getRows("Sheet5");
    const row = rows[rowIndex];

    row.set("classification", selectedOption.name);
    await row.save();
    await this.spreadsheetManager.addMapping(
      row.get("description"),
      selectedOption.name,
    );
    await ctxAction.reply(`Transaction classified as: ${selectedOption.name}`);

    // Continue with the next unclassified transaction
    await this.promptUserForClassification(ctxAction, rows, rowIndex + 1);
  }

  private async autoClassifyTransactions(context?: any) {
    try {
      logToPublicLog("Fetching rows for auto-classification...");
      const rows = await this.spreadsheetManager.getRows("Sheet5");
      logToPublicLog(`Fetched ${rows.length} rows for classification.`);
      logToPublicLog(`Fetched ${rows.length} rows for classification.`);

      const merchantCategoryMap = await this.buildMerchantCategoryMap();
      logToPublicLog(
        `Merchant Category Map size: ${Object.keys(merchantCategoryMap).length}`,
      );
      logToPublicLog(
        `Merchant Category Map size: ${Object.keys(merchantCategoryMap).length}`,
      );

      let classifiedCount = 0;

      // First pass: Auto-classification
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const description = row.get("description")?.trim().toLowerCase() || "";

        logToPublicLog(`Processing row ${index + 1}: ${description}`);
        logToPublicLog(`Processing row ${index + 1}: ${description}`);

        if (description && merchantCategoryMap[description]) {
          // Auto-classification based on the map
          const category = merchantCategoryMap[description];
          row.set("classification", category);
          await row.save();
          classifiedCount++; // Increment the classified count
          logToPublicLog(`Row ${index + 1} classified as ${category}.`);
          logToPublicLog(`Row ${index + 1} classified as ${category}.`);
        } else {
          logToPublicLog(`Row ${index + 1} could not be auto-classified.`);
          logToPublicLog(`Row ${index + 1} could not be auto-classified.`);
        }
      }

      // Send a summary message to the user
      const totalRows = rows.length;
      const summaryMessage = `Auto-classification completed. Classified ${classifiedCount} out of ${totalRows} rows.`;

      logToPublicLog(summaryMessage);
      logToPublicLog(summaryMessage);
      if (context) {
        await context.reply(summaryMessage);
        logToPublicLog("Summary message sent to user.");
      }

      // Second pass: Manual classification for remaining unclassified rows
      if (classifiedCount < totalRows) {
        logToPublicLog(
          "Some rows remain unclassified, starting manual classification...",
        );
        logToPublicLog(
          "Some rows remain unclassified, starting manual classification...",
        );
        if (context) {
          await this.promptUserForClassification(context, rows, 0);
        }
      } else {
        logToPublicLog("All rows classified during auto-classification.");
        logToPublicLog("All rows classified during auto-classification.");
      }
    } catch (error) {
      logToPublicLog(`Error in autoClassifyTransactions: ${error.message}`);
      logToPublicLog(`Error in autoClassifyTransactions: ${error.message}`);
      if (context) {
        await context.reply(
          `Error during auto-classification: ${error.message}`,
        );
        logToPublicLog("Error message sent to user.");
      }
    }
  }

  private async promptUserForClassification(
    context: any,
    rows: any[],
    startIndex: number,
  ) {
    logToPublicLog(`Starting manual classification from index ${startIndex}`);
    logToPublicLog(`Starting manual classification from index ${startIndex}`);
    for (let index = startIndex; index < rows.length; index++) {
      const row = rows[index];

      // Check if the row is unclassified
      if (!row.get("classification")) {
        logToPublicLog(`Unclassified row found at index ${index}`);
        logToPublicLog(`Unclassified row found at index ${index}`);
        const description = row.get("description") || "No Description";
        const memo = row.get("memo");
        const price = row.get("amount") || "Unknown Amount";

        const splitButton = Markup.button.callback(
          "Split Transaction",
          `split_${index}`,
        );
        const finishButton = Markup.button.callback(
          "Classification Completed",
          "finish_classification",
        );

        for (const chunk of this.chunkedClassificationOptions) {
          await context.reply(
            `Classify the transaction: ${description} | ${memo} | ${price}`,
            Markup.inlineKeyboard([
              ...chunk.map((emoji) =>
                Markup.button.callback(emoji, `classify_${index}_${emoji}`),
              ),
              splitButton,
              finishButton,
            ]),
          );
        }

        return; // Exit to wait for user input before processing further
      }
    }

    logToPublicLog(
      "Finished manual classification. No rows need classification.",
    );
    await context.reply("All transactions have been classified.");
  }

  private async buildMerchantCategoryMap(): Promise<{ [key: string]: string }> {
    const mapRows = await this.spreadsheetManager.getRows("map");
    const merchantCategoryMap: { [key: string]: string } = {};

    mapRows.forEach((mapRow) => {
      const merchantName =
        mapRow.get("merchant_name")?.trim().toLowerCase() || "";
      const category = mapRow.get("category")?.trim() || "";
      if (merchantName && category) {
        merchantCategoryMap[merchantName] = category;
      }
    });

    logToPublicLog(
      `Built merchant category map with ${Object.keys(merchantCategoryMap).length} entries.`,
    );
    return merchantCategoryMap;
  }

  private async handleSplitTransaction(ctxAction: any, rowIndex: number) {
    const rows = await this.spreadsheetManager.getRows("Sheet5");
    const row = rows[rowIndex];

    // Check if the 'override_amount' column exists, if not, create it
    const headers = await this.spreadsheetManager.getHeaders("Sheet5");
    if (!headers.includes("override_amount")) {
      headers.push("override_amount");
      await this.spreadsheetManager.setHeaders("Sheet5", headers);
    }

    // Prompt the user to enter the override amount
    await ctxAction.reply(
      "Please enter the amount you want to override for this transaction:",
    );

    // Flag to ensure the handler is only triggered once
    let handled = false;

    // Create a handler for the text input
    const handleTextResponse = async (ctx: any) => {
      if (handled) return; // Exit if this handler has already run
      handled = true; // Mark as handled

      if (ctx.message.text) {
        const overrideAmount = parseFloat(ctx.message.text);
        if (isNaN(overrideAmount)) {
          await ctx.reply("Invalid amount. Please enter a valid number.");
          return;
        }

        // Save the override amount to the 'override_amount' column
        const rowToUpdate = rows[rowIndex];
        rowToUpdate.set("override_amount", overrideAmount.toString());
        await rowToUpdate.save();

        await ctx.reply(
          `Override amount of ${overrideAmount} saved for this transaction.`,
        );

        // After saving, prompt the user to classify the same row
        await this.promptUserForClassification(ctxAction, rows, rowIndex);
      }
    };

    // Attach the handler specifically for this instance
    this.bot?.on("text", handleTextResponse);
  }
}
