import { existsSync, readFileSync } from "node:fs";
import {
  createLogger,
  enableDebugLogging,
  postJson,
  readSecretFile,
  unsafeStdout,
} from "@moneyman/common";
import {
  OkResponseSchema,
  ScrapePayloadSchema,
  TransactionSchema,
  transactionHash,
  transactionUniqueId,
  type AccountStatus,
  type ScrapePayload,
  type Transaction,
  type TransactionRow,
} from "@moneyman/protocol";
import { config, scraperConfig } from "./config.js";
import { sendFailureScreenShots } from "./failureScreenshot.js";
import { scrapeAccounts } from "./index.js";
import { getSummaryMessages } from "./messages.js";
import {
  editMessage,
  send,
  sendError,
  sendPhotos,
  uploadPrivateLog,
} from "./notifier.js";
import { getExternalIp, logRunMetadata } from "./runnerMetadata.js";
import { monitorNodeConnections } from "./security/domains.js";
import type { AccountScrapeResult } from "./types.js";

const logger = createLogger("main");
const exporterToken = readSecretFile("MONEYMAN_EXPORTER_TOKEN_PATH");

enableDebugLogging(config.options.logging.debugFilter);
monitorNodeConnections();

try {
  await run();
} catch (error) {
  logger("Scraper failed", error);
  await sendError(error, "scraper");
  process.exitCode = 1;
} finally {
  await uploadLog();
}
process.exit(process.exitCode ?? 0);

async function run() {
  const statusMessage = await send("Starting...");
  logger("External IP info:", await getExternalIp());

  const results = await scrapeAccounts(
    scraperConfig,
    async (status, totalTime) => {
      const text = status.join("\n");
      await editMessage(
        statusMessage.messageId,
        totalTime
          ? `${text}\n\nTotal time: ${totalTime.toFixed(1)} seconds`
          : text,
      );
    },
    async (error, caller) => {
      await sendError(error, caller);
    },
  );

  await Promise.all([
    send(getSummaryMessages(results), "HTML"),
    sendFailureScreenShots(sendPhotos),
  ]);

  const payload = ScrapePayloadSchema.parse(resultsToPayload(results));
  await postJson(
    config.services.exporterUrl,
    "/v1/scrapes",
    exporterToken,
    payload,
    OkResponseSchema,
    60 * 60_000,
  );
  await logRunMetadata();
}

function resultsToPayload(results: AccountScrapeResult[]): ScrapePayload {
  const accountResults: AccountStatus[] = [];
  const transactions: TransactionRow[] = [];

  for (const { companyId, result } of results) {
    accountResults.push({
      companyId,
      success: result.success,
      errorType: result.errorType,
      errorMessage: result.errorMessage,
      accountCount: result.accounts?.length ?? 0,
      txnCount:
        result.accounts?.reduce(
          (sum, account) => sum + account.txns.length,
          0,
        ) ?? 0,
    });

    if (!result.success) {
      continue;
    }

    for (const account of result.accounts ?? []) {
      for (const rawTransaction of account.txns) {
        try {
          const transaction = toTransaction(rawTransaction);
          transactions.push({
            ...transaction,
            account: account.accountNumber,
            companyId,
            hash: transactionHash(
              transaction,
              companyId,
              account.accountNumber,
            ),
            uniqueId: transactionUniqueId(
              transaction,
              companyId,
              account.accountNumber,
            ),
          });
        } catch (error) {
          void sendError(
            error,
            `Failed to process transaction for ${companyId} account ${account.accountNumber}`,
          );
        }
      }
    }
  }

  return { accountResults, transactions };
}

function toTransaction(raw: Transaction): Transaction {
  return TransactionSchema.parse({
    type: raw.type,
    identifier: raw.identifier,
    date: raw.date,
    processedDate: raw.processedDate,
    originalAmount: raw.originalAmount,
    originalCurrency: raw.originalCurrency,
    chargedAmount: raw.chargedAmount,
    chargedCurrency: raw.chargedCurrency,
    description: raw.description,
    memo: raw.memo,
    status: raw.status,
    installments: raw.installments,
    category: raw.category,
    rawTransaction: raw.rawTransaction,
  });
}

async function uploadLog() {
  const logPath = process.env.MONEYMAN_PRIVATE_LOG_PATH;
  const content =
    logPath && existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  await uploadPrivateLog(content, !unsafeStdout);
}
