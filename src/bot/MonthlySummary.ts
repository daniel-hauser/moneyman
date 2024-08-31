import { SpreadsheetManager } from "../spreadsheet/SpreadsheetManager.js";
import { createLogger } from "../utils/logger.js";
import { parse, format } from "date-fns";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { Context } from "telegraf";
import { ChartConfiguration } from "chart.js";

const logger = createLogger("MonthlySummary");

type TelegramContext = Context;

export class MonthlySummary {
  private spreadsheetManager: SpreadsheetManager;
  private classificationOptions: { emoji: string; name: string }[];
  private chartJSNodeCanvas: ChartJSNodeCanvas;

  constructor(
    spreadsheetManager: SpreadsheetManager,
    classificationOptions: { emoji: string; name: string }[],
  ) {
    this.spreadsheetManager = spreadsheetManager;
    this.classificationOptions = classificationOptions;
    this.chartJSNodeCanvas = new ChartJSNodeCanvas({ width: 800, height: 600 });
  }

  async summarizeCurrentMonth(context: TelegramContext, sheetName: string) {
    logger(`Summarizing transactions for the current month.`);

    const rows = await this.spreadsheetManager.getRows(sheetName);
    const summary: {
      [key: string]: { emoji: string; name: string; sum: number };
    } = {};
    const merchantSummary: { [key: string]: number } = {};
    const cardSummary: {
      [key: string]: { total: number; transactions: any[] };
    } = {};

    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();

    let totalSpending = 0;

    for (const row of rows) {
      // Parse the date from the format "DD/MM/YYYY"
      const date = parse(row.get("date"), "dd/MM/yyyy", new Date());
      const amount = parseFloat(row.get("amount") || "0");
      const classification = row.get("classification");
      const merchant = row.get("description") || "Unknown Merchant";
      const card = row.get("account") || "Unknown Card";

      // Ensure valid date and amount
      if (
        classification &&
        date.getMonth() === currentMonth &&
        date.getFullYear() === currentYear &&
        !isNaN(amount)
      ) {
        totalSpending += amount;

        // Category Summary
        if (!summary[classification]) {
          const option = this.classificationOptions.find(
            (option) => option.name === classification,
          );
          summary[classification] = {
            emoji: option?.emoji || "",
            name: classification,
            sum: 0,
          };
        }
        summary[classification].sum += amount;

        // Merchant Summary
        if (!merchantSummary[merchant]) {
          merchantSummary[merchant] = 0;
        }
        merchantSummary[merchant] += amount;

        // Card Summary
        if (!cardSummary[card]) {
          cardSummary[card] = { total: 0, transactions: [] };
        }
        cardSummary[card].total += amount;
        cardSummary[card].transactions.push({
          amount,
          description: merchant,
          date,
        });
      }
    }

    // Filter out categories with a sum of 0 and sort by sum ascending (most negative first)
    const sortedSummary = Object.values(summary)
      .filter((item) => item.sum !== 0)
      .sort((a, b) => a.sum - b.sum);

    // Sort merchants by total spent in ascending order (most negative first) and take top 5
    const sortedMerchants = Object.entries(merchantSummary)
      .sort(([, a], [, b]) => a - b)
      .slice(0, 5);

    // Sort transactions in each card by amount ascending (most negative first)
    const sortedCardSummary = Object.entries(cardSummary).map(
      ([card, data]) => ({
        card,
        total: data.total,
        topTransactions: data.transactions
          .sort((a, b) => a.amount - b.amount)
          .slice(0, 3),
      }),
    );

    // Construct the summary message
    let summaryMessage = `📊 **Monthly Summary**\n\n`;
    summaryMessage += `💰 **Total Spending**: ${totalSpending.toFixed(2)}\n\n`;

    summaryMessage += `📂 **Spending by Category**:\n`;
    sortedSummary.forEach((item) => {
      summaryMessage += `${item.emoji} ${item.name}: ${item.sum.toFixed(2)}\n`;
    });
    summaryMessage += `\n🏬 **Top 5 Merchants**:\n`;
    sortedMerchants.forEach(([merchant, amount]) => {
      summaryMessage += `${merchant}: ${amount.toFixed(2)}\n`;
    });

    summaryMessage += `\n💳 **Spending by Credit Card**:\n`;
    sortedCardSummary.forEach((cardData) => {
      summaryMessage += `**${cardData.card}**: ${cardData.total.toFixed(2)}\n`;
      cardData.topTransactions.forEach((tx) => {
        summaryMessage += `  - ${tx.description}: ${tx.amount.toFixed(2)} (${format(tx.date, "dd/MM/yyyy")})\n`;
      });
      summaryMessage += "\n";
    });

    await context.reply(summaryMessage);
    logger("Summary sent to user.");

    // Generate and send a pie chart for spending by category
    await this.sendCategorySpendingGraph(context, sortedSummary);
  }

  private async sendCategorySpendingGraph(
    context: TelegramContext,
    sortedSummary: { emoji: string; name: string; sum: number }[],
  ) {
    const labels = sortedSummary.map((item) => `${item.emoji} ${item.name}`);
    const data = sortedSummary.map((item) => Math.abs(item.sum)); // Use absolute values for the pie chart

    const chartConfig: ChartConfiguration<"pie", number[], string> = {
      type: "pie",
      data: {
        labels,
        datasets: [
          {
            label: "Spending by Category",
            data,
            backgroundColor: [
              "rgba(255, 99, 132, 0.2)",
              "rgba(54, 162, 235, 0.2)",
              "rgba(255, 206, 86, 0.2)",
              "rgba(75, 192, 192, 0.2)",
              "rgba(153, 102, 255, 0.2)",
              "rgba(255, 159, 64, 0.2)",
            ],
            borderColor: [
              "rgba(255, 99, 132, 1)",
              "rgba(54, 162, 235, 1)",
              "rgba(255, 206, 86, 1)",
              "rgba(75, 192, 192, 1)",
              "rgba(153, 102, 255, 1)",
              "rgba(255, 159, 64, 1)",
            ],
            borderWidth: 1,
          },
        ],
      },
    };

    const imageBuffer = await this.chartJSNodeCanvas.renderToBuffer(
      chartConfig as any,
    );
    await context.replyWithPhoto({ source: imageBuffer });
  }
}
