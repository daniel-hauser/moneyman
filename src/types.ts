import type { CompanyTypes } from "israeli-bank-scrapers";
import type { Transaction } from "israeli-bank-scrapers/lib/transactions";
import type {
  ScaperScrapingResult,
  ScraperCredentials,
} from "israeli-bank-scrapers/lib/scrapers/base-scraper";

export interface AccountConfig extends ScraperCredentials {
  companyId: CompanyTypes;
}

export interface TransactionRow extends Transaction {
  hash: string;
  account: string;
}

export interface AccountScrapeResult {
  companyId: CompanyTypes;
  result: ScaperScrapingResult;
}

export type CategoryString = string;
export type CategoryDef = {
  contains?: Array<string>;
  startsWith?: Array<string>;
  eq?: Array<string>;
};

export interface SaveStats {
  name: string;
  added: number;
  skipped: number;
  replaced: number; // rows changed from pending to other??
}

export interface TransactionStorage {
  existingTransactionsHashes: Set<string>;
  init(): Promise<void>;
  saveTransactions(txns: Array<TransactionRow>): Promise<SaveStats>;
}
