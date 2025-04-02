import type { CompanyTypes } from "israeli-bank-scrapers";
import puppeteer, {
  type Browser,
  type BrowserContext,
  type PuppeteerLaunchOptions,
} from "puppeteer";
import { createLogger } from "../utils/logger.js";
import { initDomainTracking } from "../security/domains.js";

export const browserArgs = ["--disable-dev-shm-usage", "--no-sandbox"];
export const browserExecutablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

const logger = createLogger("browser");

export async function createBrowser(): Promise<Browser> {
  const options = {
    args: browserArgs,
    executablePath: browserExecutablePath,
  } satisfies PuppeteerLaunchOptions;

  logger("Creating browser", options);
  return puppeteer.launch(options);
}

export async function createSecureBrowserContext(
  browser: Browser,
  companyId: CompanyTypes,
): Promise<BrowserContext> {
  const context = await browser.createBrowserContext();
  await initDomainTracking(context, companyId);
  return context;
}
