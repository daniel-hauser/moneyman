import type { CompanyTypes } from "israeli-bank-scrapers";
import type { Transaction } from "israeli-bank-scrapers/lib/transactions";
import type {
  ScraperScrapingResult,
  ScraperCredentials,
} from "israeli-bank-scrapers";
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

export interface SaveStats {
  /**
   * Store name
   */
  name: string;
  /**
   * Store elements to be updated (Accounts, budgets, etc ...)
   */
  table: string;
  /**
   * Total scrapped transactions handled
   */
  total: number;
  /**
   * Newly added to store
   */
  added: number;
  /**
   * Transactions existing in store that changed status and updated
   */
  updated?: number;
  /**
   * Total scrapped transactions that are pending status
   */
  pending: number;
  /**
   * Transactions not added due to validation checks or the already exist
   */
  skipped: number;
  /**
   * Transactions that already exists in store and don't required an update
   */
  existing: number;
  /**
   * Scrapped transactions that are charged in foreign currency (not ILS)
   */
  foreign: number;
  /**
   * Transactions to be highlighted in the stats report
   */
  highlightedTransactions?: Record<string, Array<TransactionRow>>;
}

export interface TransactionStorage {
  canSave(): boolean;
  init(): Promise<void>;
  saveTransactions(txns: Array<TransactionRow>): Promise<SaveStats>;
}
