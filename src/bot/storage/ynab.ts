import { TransactionRow, TransactionStorage } from "../../types.js";
import { createLogger } from "../../utils/logger.js";
import { format, parseISO } from "date-fns";
import * as ynab from "ynab";
import { hash } from "hash-it";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { sendDeprecationMessage } from "../deprecationManager.js";
import { createSaveStats } from "../saveStats.js";
import type { MoneymanConfig } from "../../config.js";
import assert from "node:assert";

const YNAB_DATE_FORMAT = "yyyy-MM-dd";
const logger = createLogger("YNABStorage");

export class YNABStorage implements TransactionStorage {
  private ynabAPI: ynab.API;
  private budgetName = "";
  private accountToYnabAccount = new Map<string, string>();
  private ynabAccountToTransferPayeeId = new Map<string, string>();

  constructor(private config: MoneymanConfig) {}

  async init() {
    logger("init");
    const ynabConfig = this.config.storage.ynab;
    assert(ynabConfig, "YNAB configuration not found");

    this.ynabAPI = new ynab.API(ynabConfig.token);
    this.budgetName = await this.getBudgetName(ynabConfig.budgetId);
    this.accountToYnabAccount = new Map(Object.entries(ynabConfig.accounts));
    this.ynabAccountToTransferPayeeId = await this.fetchTransferPayeeIds(
      ynabConfig.budgetId,
    );
    logger(
      `loaded ${this.ynabAccountToTransferPayeeId.size} transfer payee mappings`,
    );
  }

  canSave() {
    return Boolean(this.config.storage.ynab);
  }

  isDateInFuture(date: string) {
    return new Date(date) > new Date();
  }

  async saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
  ) {
    await Promise.all([onProgress("Initializing"), this.init()]);

    const stats = createSaveStats(
      "YNABStorage",
      `budget: "${this.budgetName}"`,
      txns,
    );

    // Initialize an array to store non-pending and non-empty account ID transactions on YNAB format.
    const txToSend: ynab.NewTransaction[] = [];
    const missingAccounts = new Set<string>();

    for (let tx of txns) {
      const isPending = tx.status === TransactionStatuses.Pending;
      // YNAB doesn't support future transactions. Will result in 400 Bad Request
      const isDateInFuture = this.isDateInFuture(tx.date);
      if (isPending || isDateInFuture) {
        if (isDateInFuture) {
          stats.otherSkipped++;
        }
        continue;
      }

      const accountId = this.accountToYnabAccount.get(tx.account);
      if (!accountId) {
        missingAccounts.add(tx.account);
        stats.otherSkipped++;
        continue;
      }

      // Converting to YNAB format.
      const ynabTx = this.convertTransactionToYnabFormat(tx, accountId);

      // Add non-pending and non-empty account ID transactions to the array.
      txToSend.push(ynabTx);
    }

    if (txToSend.length > 0) {
      // Send transactions to YNAB
      logger(`sending to YNAB budget: "${this.budgetName}"`);
      const [resp] = await Promise.all([
        this.ynabAPI.transactions.createTransactions(
          this.config.storage.ynab!.budgetId,
          {
            transactions: txToSend,
          },
        ),
        onProgress("Sending"),
      ]);
      logger("transactions sent to YNAB successfully!");
      stats.added = resp.data.transactions?.length ?? 0;
      stats.existing = resp.data.duplicate_import_ids?.length ?? 0;

      if (this.config.options.scraping.transactionHashType !== "moneyman") {
        sendDeprecationMessage("hashFiledChange");
      }
    }

    if (missingAccounts.size > 0) {
      logger(`Accounts missing in YNAB_ACCOUNTS:`, missingAccounts);
    }

    return stats;
  }

  private async getBudgetName(budgetId: string) {
    const planResponse = await this.ynabAPI.plans.getPlanById(budgetId);
    if (planResponse.data) {
      return planResponse.data.plan.name;
    } else {
      throw new Error(`YNAB_BUDGET_ID does not exist in YNAB: ${budgetId}`);
    }
  }

  private async fetchTransferPayeeIds(
    budgetId: string,
  ): Promise<Map<string, string>> {
    const accountsResponse = await this.ynabAPI.accounts.getAccounts(budgetId);
    if (!accountsResponse.data) {
      throw new Error(`Failed to fetch accounts for budget: ${budgetId}`);
    }
    const map = new Map<string, string>();
    for (const account of accountsResponse.data.accounts) {
      if (!account.deleted && !account.closed && account.transfer_payee_id) {
        map.set(account.id, account.transfer_payee_id);
      }
    }
    return map;
  }

  // When a scraped transaction's identifier matches the key of a *different*
  // configured account, treat the transaction as a transfer to that account.
  // This covers cases where the bank's activityDescription doesn't distinguish
  // between cards (e.g. Bank Hapoalim returns the bare "כאל" for every Visa-Cal
  // debit, with the actual card last-4 surfaced only in the reference number
  // field — which israeli-bank-scrapers exposes as tx.identifier).
  private resolveTransferPayeeId(
    tx: TransactionRow,
    sourceAccountId: string,
  ): string | undefined {
    const identifier = tx.identifier?.toString();
    if (!identifier) return undefined;

    const targetAccountId = this.accountToYnabAccount.get(identifier);
    if (!targetAccountId || targetAccountId === sourceAccountId) {
      return undefined;
    }

    const transferPayeeId =
      this.ynabAccountToTransferPayeeId.get(targetAccountId);
    if (transferPayeeId) {
      logger(
        `routing tx as transfer: source=${sourceAccountId} identifier=${identifier} -> target=${targetAccountId}`,
      );
    }
    return transferPayeeId;
  }

  private convertTransactionToYnabFormat(
    tx: TransactionRow,
    accountId: string,
  ): ynab.SaveTransactionWithIdOrImportId {
    const amount = Math.round(tx.chargedAmount * 1000);
    const transferPayeeId = this.resolveTransferPayeeId(tx, accountId);

    return {
      account_id: accountId,
      date: format(parseISO(tx.date), YNAB_DATE_FORMAT, {}),
      amount,
      payee_id: transferPayeeId,
      payee_name: transferPayeeId ? undefined : tx.description,
      cleared:
        tx.status === TransactionStatuses.Completed
          ? ynab.TransactionClearedStatus.Cleared
          : undefined,
      approved: false,
      import_id: hash(
        this.config.options.scraping.transactionHashType === "moneyman"
          ? tx.uniqueId
          : tx.hash,
      ).toString(),
      memo: tx.memo,
    };
  }
}
