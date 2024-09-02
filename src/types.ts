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
  name: string;     // Store name
  table: string;
  total: number;    // Total scrapped transactions handled
  added: number;    // Newly added to store
  updated?: number;  // Existing that changed and updated
  pending: number;  // Total scrapped transactions that are pending
  skipped: number;  // Transactions not added due to validation checks or the already exist
  existing: number; // Scrapped transactions that already exists in store 
  foreign?: number; // Scrapped transactions that are charged in foreign currency (not ILS)
  highlightedTransactions?: Record<string, Array<TransactionRow>>;
}

export interface TransactionStorage {
  canSave(): boolean;
  init(): Promise<void>;
  saveTransactions(txns: Array<TransactionRow>): Promise<SaveStats>;
  logStats(stats: SaveStats): string;
}
