import type { CompanyTypes } from "israeli-bank-scrapers";
import puppeteer, {
  type Browser,
  type BrowserContext,
  type PuppeteerLaunchOptions,
} from "puppeteer";
import { createLogger } from "../utils/logger.js";
import { initDomainTracking } from "../security/domains.js";

const { HEADED_MODE, PUPPETEER_EXECUTABLE_PATH } = process.env;

const headless = HEADED_MODE !== "true";
const args = headless
  ? ["--disable-dev-shm-usage", "--no-sandbox"]
  : [
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
    ];

const logger = createLogger("browser");

export async function createBrowser(): Promise<Browser> {
  const options = {
    args,
    headless,
    executablePath: PUPPETEER_EXECUTABLE_PATH || undefined,
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
