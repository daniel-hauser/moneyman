import { CompanyTypes } from "israeli-bank-scrapers";
import { type BrowserContext } from "puppeteer";

export async function initDomainTracking(
  _browserContext: BrowserContext,
  _companyId: CompanyTypes,
): Promise<void> {}

export async function reportUsedDomains(
  _report: (domains: Partial<Record<CompanyTypes, unknown>>) => Promise<void>,
): Promise<void> {}
