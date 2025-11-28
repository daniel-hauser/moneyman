import { BrowserContext, Page } from "puppeteer";
import { createLogger } from "../utils/logger.js";
import { config } from "../config.js";
import { CompanyTypes } from "israeli-bank-scrapers";

const logger = createLogger("cookies");

export interface SerializedCookies {
  [companyId: string]: {
    cookies: any[];
    timestamp: number;
  };
}

/**
 * Get cookies storage from environment or config
 */
function getCookiesStorage(): SerializedCookies {
  const cookiesJson = config.options.scraping.persistedCookies;
  if (!cookiesJson) {
    return {};
  }

  try {
    return JSON.parse(cookiesJson);
  } catch (e) {
    logger("Failed to parse cookies from storage", e);
    return {};
  }
}

/**
 * Check if stored cookies are still valid (not expired)
 */
function areCookiesValid(timestamp: number, maxAgeHours: number = 168): boolean {
  const ageMs = Date.now() - timestamp;
  const ageHours = ageMs / (1000 * 60 * 60);
  return ageHours < maxAgeHours;
}

/**
 * Restore cookies for a specific company to the browser context
 */
export async function restoreCookies(
  context: BrowserContext,
  companyId: CompanyTypes,
): Promise<boolean> {
  if (!config.options.scraping.enableCookiePersistence) {
    logger("Cookie persistence is disabled");
    return false;
  }

  const storage = getCookiesStorage();
  const companyCookies = storage[companyId];

  if (!companyCookies) {
    logger(`No stored cookies found for ${companyId}`);
    return false;
  }

  if (!areCookiesValid(companyCookies.timestamp)) {
    logger(`Stored cookies for ${companyId} are expired`);
    return false;
  }

  try {
    // Get all pages in the context to set cookies
    const pages = await context.pages();
    if (pages.length === 0) {
      logger("No pages available to restore cookies");
      return false;
    }

    const page = pages[0];
    await page.setCookie(...companyCookies.cookies);
    logger(
      `Restored ${companyCookies.cookies.length} cookies for ${companyId}`,
    );
    return true;
  } catch (e) {
    logger(`Failed to restore cookies for ${companyId}`, e);
    return false;
  }
}

/**
 * Save cookies from a page for future use
 */
export async function saveCookies(
  page: Page,
  companyId: CompanyTypes,
): Promise<void> {
  if (!config.options.scraping.enableCookiePersistence) {
    logger("Cookie persistence is disabled");
    return;
  }

  try {
    const cookies = await page.cookies();
    if (cookies.length === 0) {
      logger(`No cookies to save for ${companyId}`);
      return;
    }

    const storage = getCookiesStorage();
    storage[companyId] = {
      cookies,
      timestamp: Date.now(),
    };

    // Output the serialized cookies to console so they can be captured
    // In GitHub Actions, users can save this output to secrets
    const serialized = JSON.stringify(storage);
    logger(`Saved ${cookies.length} cookies for ${companyId}`);

    // Log the cookies in a format that can be easily extracted
    console.log("\n=== PERSISTED_COOKIES ===");
    console.log(serialized);
    console.log("=== END_PERSISTED_COOKIES ===\n");

    logger(
      "To persist cookies between runs, save the above JSON to PERSISTED_COOKIES secret/environment variable",
    );
  } catch (e) {
    logger(`Failed to save cookies for ${companyId}`, e);
  }
}

/**
 * Setup cookie persistence for a browser context
 * Restores cookies on context creation and saves them after successful scraping
 */
export async function setupCookiePersistence(
  context: BrowserContext,
  companyId: CompanyTypes,
): Promise<void> {
  if (!config.options.scraping.enableCookiePersistence) {
    return;
  }

  await restoreCookies(context, companyId);
}
