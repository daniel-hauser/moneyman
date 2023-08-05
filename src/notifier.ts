import { Telegraf, TelegramError } from "telegraf";
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
import { createLogger, logToPublicLog } from "./utils/logger.js";

const logger = createLogger("notifier");

const bot =
  TELEGRAM_API_KEY && TELEGRAM_CHAT_ID ? new Telegraf(TELEGRAM_API_KEY) : null;

logToPublicLog(
  bot
    ? "Telegram logger initialized, status and errors will be sent"
    : "No Telegram bot info, status and errors will not be sent",
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
  newText: string,
) {
  if (message !== undefined) {
    try {
      await bot?.telegram.editMessageText(
        TELEGRAM_CHAT_ID,
        message,
        undefined,
        newText,
      );
    } catch (e) {
      if (canIgnoreTelegramError(e)) {
        logger(`Ignoring error`, e);
      } else {
        throw e;
      }
    }
  }
}

function canIgnoreTelegramError(e: Error) {
  return (
    e instanceof TelegramError &&
    e.response.description.startsWith("Bad Request: message is not modified")
  );
}

export function sendError(message: any, caller: string = "") {
  return send(
    `${caller}\n❌ ${String(
      message instanceof Error
        ? `${message.message}\n${message.stack}`
        : message,
    )}`.trim(),
  );
}

export function getSummaryMessage(
  results: Array<AccountScrapeResult>,
  stats: Array<SaveStats>,
) {
  const accountsSummary = results.flatMap(({ result, companyId }) => {
    if (!result.success) {
      return `\t❌ [${companyId}] ${result.errorType}${
        result.errorMessage ? `\n\t${result.errorMessage}` : ""
      }`;
    }
    return result.accounts?.map(
      (account) =>
        `\t✔️ [${companyId}] ${account.accountNumber}: ${account.txns.length}`,
    );
  });

  const saveSummary = stats.map((s) => statsString(s));

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
  Worksheet name: ${worksheetName}
  Start Date: ${scrapeStartDate.toISOString()} (${daysBackToScrape} days back)
  TZ: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
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

function statsString(starts: SaveStats): string {
  return `
  📝 ${starts.name} (${starts.table})
    ${starts.added} added, ${starts.skipped} skipped
    (${starts.existing} existing,  ${starts.pending} pending)
`.trim();
}
