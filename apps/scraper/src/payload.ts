import { createLogger } from "@moneyman/common";
import {
  TransactionSchema,
  transactionHash,
  transactionUniqueId,
  type AccountStatus,
  type ScrapePayload,
  type Transaction,
  type TransactionRow,
} from "@moneyman/protocol";
import type { AccountScrapeResult } from "./types.js";

const logger = createLogger("payload");

type ReportError = (error: unknown, caller: string) => Promise<unknown>;

export async function resultsToPayload(
  results: AccountScrapeResult[],
  reportError: ReportError,
): Promise<ScrapePayload> {
  const accountResults: AccountStatus[] = [];
  const transactions: TransactionRow[] = [];
  const invalidTransactionNotifications: Promise<unknown>[] = [];

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
          invalidTransactionNotifications.push(
            reportError(
              error,
              `Failed to process transaction for ${companyId} account ${account.accountNumber}`,
            ),
          );
        }
      }
    }
  }

  const notificationResults = await Promise.allSettled(
    invalidTransactionNotifications,
  );
  notificationResults.forEach((result) => {
    if (result.status === "rejected") {
      logger("Failed to report an invalid transaction", result.reason);
    }
  });

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
