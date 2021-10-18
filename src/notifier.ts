import { Telegraf } from "telegraf";
import { Message } from "telegraf/typings/core/types/typegram";
import { TELEGRAM_API_KEY, TELEGRAM_CHAT_ID } from "./config.js";
import type { AccountScrapeResult, SaveStats } from "./types.js";

const bot = new Telegraf(TELEGRAM_API_KEY);

export async function send(message: string) {
  console.info(`[send] ${message}`);
  return await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, message);
}

export async function deleteMessage(message: Message.TextMessage) {
  await bot.telegram.deleteMessage(TELEGRAM_CHAT_ID, message.message_id);
}
export async function sendError(message: any) {
  return await send("❌ " + String(message));
}

export function getSummaryMessage(
  results: Array<AccountScrapeResult>,
  stats: Array<SaveStats>
) {
  const accountsSummary = results.map(({ result, companyId }) => {
    if (!result.success) {
      return `❌ [${companyId}] ${result.errorType}\n\t${result.errorMessage}`;
    }
    return result.accounts
      .map(
        (account) =>
          `✔️ [${companyId}] ${account.accountNumber}: ${account.txns.length}`
      )
      .join("\n\t");
  });

  const saveSummary = stats
    .map((s) => {
      return `\t${s.name}\n\t${s.added} added, ${s.skipped} skipped`;
    })
    .join("\n");

  return `
Accounts updated:
${accountsSummary || "\t😶 None"}
Saved to:
${saveSummary || "\t😶 None"}
  `.trim();
}
