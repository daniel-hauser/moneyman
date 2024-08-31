// ManualClassifier.ts

import { Telegraf, Markup } from "telegraf";
import { SpreadsheetManager } from "../spreadsheet/SpreadsheetManager.js";
import { createLogger } from "../utils/logger.js";
import { MonthlySummary } from "./MonthlySummary.js";
import { parseISO, isSameMonth } from "date-fns";

const logger = createLogger("ManualClassifier");

export class ManualClassifier {
  private bot: Telegraf;
  private classificationOptions: { emoji: string; name: string }[];
  private spreadsheetManager: SpreadsheetManager;
  private monthlySummary: MonthlySummary;

  constructor(
    bot: Telegraf,
    classificationOptions: { emoji: string; name: string }[],
    spreadsheetManager: SpreadsheetManager,
  ) {
    this.bot = bot;
    this.classificationOptions = classificationOptions;
    this.spreadsheetManager = spreadsheetManager;
    this.monthlySummary = new MonthlySummary(
      spreadsheetManager,
      classificationOptions,
    );
  }

  startBot() {
    this.bot.command("classify", async (context) => {
      try {
        logger("Manual classification started by user command.");
        await this.promptUserForClassification(context, "Sheet5", 0);
      } catch (error) {
        logger(`Error during manual classification: ${error.message}`);
        context.reply(`Error during manual classification: ${error.message}`);
      }
    });

    this.bot.command("summarize", async (context) => {
      try {
        logger("Summary requested by user command.");
        await this.monthlySummary.summarizeCurrentMonth(context, "Sheet5");
      } catch (error) {
        logger(`Error during summary generation: ${error.message}`);
        context.reply(`Error during summary generation: ${error.message}`);
      }
    });

    this.bot.action(/^classify_(\d+)_(.+)$/, async (context) => {
      try {
        const rowIndex = parseInt(context.match[1]);
        const selectedEmoji = context.match[2];

        logger(
          `User selected classification: ${selectedEmoji} for row ${rowIndex}`,
        );

        const selectedOption = this.classificationOptions.find(
          (option) => option.emoji === selectedEmoji,
        );

        if (selectedOption) {
          await this.handleClassification(context, rowIndex, selectedOption);
        } else {
          await context.reply("Error: Classification option not found.");
        }
      } catch (error) {
        logger(`Error handling classification: ${error.message}`);
        context.reply(`Error handling classification: ${error.message}`);
      }
    });

    this.bot.action(/^next_(\d+)$/, async (context) => {
      try {
        const rowIndex = parseInt(context.match[1]);
        logger(
          `User skipped row ${rowIndex}, moving to next unclassified row.`,
        );
        await this.promptUserForClassification(context, "Sheet5", rowIndex + 1);
      } catch (error) {
        logger(`Error handling next action: ${error.message}`);
        context.reply(`Error handling next action: ${error.message}`);
      }
    });

    this.bot
      .launch()
      .then(() => {
        logger("Bot launched successfully.");
      })
      .catch((error) => {
        logger(`Bot launch failed: ${error.message}`);
      });
  }

  async promptUserForClassification(
    context: any,
    sheetName: string,
    startIndex: number,
  ) {
    logger(`Starting manual classification from index ${startIndex}`);

    const rows = await this.spreadsheetManager.getRows(sheetName);
    let unclassifiedFound = false;

    for (let index = startIndex; index < rows.length; index++) {
      const row = rows[index];

      if (!row.get("classification")) {
        unclassifiedFound = true;
        logger(`Unclassified row found at index ${index}`);
        const description = row.get("description") || "No Description";
        const memo = row.get("memo");
        const price = row.get("amount") || "Unknown Amount";

        const splitButton = Markup.button.callback(
          "Split Transaction",
          `split_${index}`,
        );
        const nextButton = Markup.button.callback("Next", `next_${index}`);
        const finishButton = Markup.button.callback(
          "Classification Completed",
          "finish_classification",
        );

        for (const chunk of this.chunkArray(
          this.classificationOptions.map((option) => option.emoji),
          8,
        )) {
          await context.reply(
            `Classify the transaction: ${description} | ${memo} | ${price}`,
            Markup.inlineKeyboard([
              ...chunk.map((emoji) =>
                Markup.button.callback(emoji, `classify_${index}_${emoji}`),
              ),
              splitButton,
              nextButton,
              finishButton,
            ]),
          );
        }

        return; // Exit to wait for user input before processing further
      }
    }

    if (!unclassifiedFound) {
      logger("Finished manual classification. No rows need classification.");
      await context.reply("All transactions have been classified.");

      // Automatically trigger the summary after classification is done
      await context.reply("Summarizing...");
      await this.monthlySummary.summarizeCurrentMonth(context, sheetName);
    }
  }

  private async handleClassification(
    context: any,
    rowIndex: number,
    selectedOption: { emoji: string; name: string },
  ) {
    const rows = await this.spreadsheetManager.getRows("Sheet5");
    const row = rows[rowIndex];

    // Set the classification in the sheet
    row.set("classification", selectedOption.name);
    await row.save();

    logger(`Row ${rowIndex + 1} classified as: ${selectedOption.name}`);
    await context.reply(`Transaction classified as: ${selectedOption.name}`);

    // Continue to the next unclassified row
    await this.promptUserForClassification(context, "Sheet5", rowIndex + 1);
  }

  private chunkArray(array: string[], chunkSize: number): string[][] {
    const result: string[][] = [];
    for (let index = 0; index < array.length; index += chunkSize) {
      result.push(array.slice(index, index + chunkSize));
    }
    return result;
  }
}
