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
  additionalTransactionInformation: boolean;
  includeRawTransaction: boolean;
};

export type ImageWithCaption = {
  photoPath: string;
  caption: string;
};

export interface RunnerHooks {
  onBeforeStart(): Promise<void>;
  onStatusChanged(rows: string[], totalTime?: number): Promise<void>;
  onResultsReady(results: AccountScrapeResult[]): Promise<void>;
  onError(e: Error, caller?: string): Promise<void>;
  failureScreenshotsHandler: (photos: ImageWithCaption[]) => Promise<unknown>;
}
export type Runner = (hooks: RunnerHooks) => Promise<void>;
