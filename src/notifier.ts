import { Telegraf } from "telegraf";
import { Message } from "telegraf/typings/core/types/typegram";
import {
  daysBackToScrape,
  scrapeStartDate,
  TELEGRAM_API_KEY,
  TELEGRAM_CHAT_ID,
  worksheetName,
} from "./config.js";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import type { AccountScrapeResult, SaveStats } from "./types.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("notifier");

const bot =
  TELEGRAM_API_KEY && TELEGRAM_CHAT_ID ? new Telegraf(TELEGRAM_API_KEY) : null;

console.log(
  bot
    ? "Telegram logger initialized, status and errors will be sent"
    : "No Telegram bot info, status and errors will not be sent"
);

export async function send(message: string) {
  logger(message);
  return await bot?.telegram.sendMessage(TELEGRAM_CHAT_ID, message);
}

export async function deleteMessage(message: Message.TextMessage) {
  await bot?.telegram.deleteMessage(TELEGRAM_CHAT_ID, message.message_id);
}

export async function editMessage(
  message: number | undefined,
  newText: string
) {
  if (message !== undefined) {
    await bot?.telegram.editMessageText(
      TELEGRAM_CHAT_ID,
      message,
      undefined,
      newText
    );
  }
}

export function sendError(message: any) {
  return send(`❌ ${String(message)}`);
}

export function getSummaryMessage(
  results: Array<AccountScrapeResult>,
  stats: Array<SaveStats>
) {
  const accountsSummary = results.flatMap(({ result, companyId }) => {
    if (!result.success) {
      return `\t❌ [${companyId}] ${result.errorType}${
        result.errorMessage ? `\n\t${result.errorMessage}` : ""
      }`;
    }
    return result.accounts?.map(
      (account) =>
        `\t✔️ [${companyId}] ${account.accountNumber}: ${account.txns.length}`
    );
  });

  const saveSummary = stats.map((s) => {
    const skipped = s.existing + s.pending;
    return `\t📝 ${s.name} (${s.sheetName})
\t\t${s.added} added, ${skipped} skipped
\t\t(${s.existing} existing,  ${s.pending} pending)`;
  });

  return `
Accounts updated:
${accountsSummary.join("\n") || "\t😶 None"}
Saved to:
${saveSummary.join("\n") || "\t😶 None"}
${getPendingSummary(results)}
`.trim();
}

export function getConfigSummary() {
  return `
Config:
\tWorksheet name: ${worksheetName}
\tStart Date: ${scrapeStartDate.toISOString()} (${daysBackToScrape} days back)
\tTZ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
  `;
}

function getPendingSummary(results: Array<AccountScrapeResult>) {
  const pending = results
    .flatMap(({ result }) => result.accounts)
    .flatMap((account) => account?.txns)
    .filter(Boolean)
    .filter((t) => t?.status === TransactionStatuses.Pending);

  return pending.length
    ? `Pending txns:\n${pending.map((t) => t?.description).join("\n")}`
    : "";
}
