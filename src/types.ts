import type { CompanyTypes } from "israeli-bank-scrapers";
import type { Transaction } from "israeli-bank-scrapers/lib/transactions.js";
import type {
  ScraperCredentials,
  ScraperScrapingResult,
} from "israeli-bank-scrapers";
import { SaveStats } from "./bot/saveStats.js";
export type { Transaction };

export type AccountConfig = ScraperCredentials & {
  companyId: CompanyTypes;
};

export interface TransactionRow extends Transaction {
  account: string;
  companyId: CompanyTypes;
  hash: string;
  uniqueId: string;
}

export interface AccountScrapeResult {
  companyId: CompanyTypes;
  /**
   * Masked label of the account that was scraped, e.g. `isracard · ••3456`.
   * Set for results produced by the scraper; older callers may omit it and
   * renderers fall back to `companyId`.
   */
  accountLabel?: string;
  /** Stable id of the account's non-secret login fields, for run selections */
  accountId?: string;
  result: ScraperScrapingResult;
}

export type CategoryString = string;
export type CategoryDef = {
  contains?: Array<string>;
  startsWith?: Array<string>;
  eq?: Array<string>;
};

export interface AccountStatus {
  companyId: string;
  success: boolean;
  errorType?: string;
  errorMessage?: string;
  accountCount?: number;
  txnCount?: number;
}

export interface SaveContext {
  accountResults?: AccountStatus[];
}

export interface TransactionStorage {
  canSave(): boolean;
  saveTransactions(
    txns: Array<TransactionRow>,
    onProgress: (status: string) => Promise<void>,
    context?: SaveContext,
  ): Promise<SaveStats>;
  sendLogs?(logs: string): Promise<void>;
}

export type ScraperConfig = {
  startDate: Date;
  futureMonthsToScrape: number;
  parallelScrapers: number;
  accounts: Array<AccountConfig>;
  /** Account id -> label, from the whole configured account set */
  accountLabels?: Record<string, string>;
  additionalTransactionInformation: boolean;
  includeRawTransaction: boolean;
};

export type ImageWithCaption = {
  photoPath: string;
  caption: string;
};

export interface RunTiming {
  id: string;
  parentId?: string;
  kind: "scraper" | "storage" | "step";
  name: string;
  /** Epoch milliseconds, shared across the runner and scraper worker. */
  startedAt: number;
  endedAt?: number;
  failed?: boolean;
}

export interface RunnerHooks {
  onTiming?(timing: RunTiming): Promise<void> | void;
  onBeforeStart(): Promise<void>;
  onStatusChanged(rows: string[], totalTime?: number): Promise<void>;
  onResultsReady(results: AccountScrapeResult[]): Promise<void>;
  onError(e: unknown, caller?: string): Promise<void>;
  failureScreenshotsHandler: (photos: ImageWithCaption[]) => Promise<unknown>;
}
export type Runner = (hooks: RunnerHooks) => Promise<void>;

export type RunTrigger = "manual" | "scheduled" | "startup";

export type RunOptions = {
  signal?: AbortSignal;
  /**
   * Scrape only the accounts with these ids (see `accountId()` in
   * `utils/accountLabel.ts`). All configured accounts when omitted or empty.
   */
  accountIds?: readonly string[];
};

export type RunStatus = {
  trigger: RunTrigger;
  startedAt: Date;
  endedAt: Date;
  failed: boolean;
  /** Ids of the accounts that failed in this run, for the `/scrape_provider` picker */
  failedAccountIds?: readonly string[];
};

export type RunHandle = {
  /** Whether this call took the run lock. When false, `finished` resolves to undefined. */
  started: boolean;
  /** Settles when the run this handle started has finished. */
  finished: Promise<RunStatus | undefined>;
};
