import type {
  CompanyTypes,
  ScraperScrapingResult,
} from "israeli-bank-scrapers";

export interface AccountScrapeResult {
  companyId: CompanyTypes;
  result: ScraperScrapingResult;
}

export interface ImageWithCaption {
  photoPath: string;
  caption: string;
}
