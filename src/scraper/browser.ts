import type { CompanyTypes } from "israeli-bank-scrapers";
import puppeteer, {
  TargetType,
  type Browser,
  type BrowserContext,
  type CookieParam,
  type LaunchOptions,
} from "puppeteer";
import { createLogger } from "../utils/logger.js";
import {
  runInLoggerContext,
  loggerContextStore,
} from "../utils/asyncContext.js";
import { initDomainTracking } from "../security/domains.js";
import { solveTurnstile } from "./cloudflareSolver.js";
import { config } from "../config.js";

export const browserArgs = [
  "--disable-dev-shm-usage",
  "--no-sandbox",
  // Reduce easy automation fingerprints used by anti-bot providers.
  "--disable-blink-features=AutomationControlled",
];
export const browserExecutablePath =
  config.options.scraping.puppeteerExecutablePath || undefined;

const logger = createLogger("browser");

export async function createBrowser(): Promise<Browser> {
  const options = {
    args: browserArgs,
    executablePath: browserExecutablePath,
    // Hide the "Chrome is being controlled by automated software" marker.
    ignoreDefaultArgs: ["--enable-automation"],
  } satisfies LaunchOptions;

  logger("Creating browser", options);
  return puppeteer.launch(options);
}

export async function createSecureBrowserContext(
  browser: Browser,
  companyId: CompanyTypes,
): Promise<BrowserContext> {
  const context = await browser.createBrowserContext();
  await initDomainTracking(context, companyId);
  await initCloudflareSkipping(context);
  await injectCookiesFromEnv(context, companyId);
  return context;
}

async function injectCookiesFromEnv(
  context: BrowserContext,
  companyId: CompanyTypes,
) {
  const raw = process.env.MONEYMAN_BROWSER_COOKIES;
  if (!raw) return;

  try {
    // Expected format: { "hapoalim": [...], "visaCal": [...] }
    const parsed: Record<string, CookieParam[]> = JSON.parse(raw);
    const cookies = parsed[companyId] ?? [];

    if (cookies.length === 0) return;

    logger("Injecting %d cookies for %s", cookies.length, companyId);
    const page = await context.newPage();
    await page.setCookie(...cookies);
    await page.close();
  } catch (e) {
    logger("Failed to parse MONEYMAN_BROWSER_COOKIES", e);
  }
}

async function initCloudflareSkipping(browserContext: BrowserContext) {
  const activeContext = loggerContextStore.getStore();

  const cfParam = "__cf_chl_rt_tk";

  logger("Setting up Cloudflare skipping");
  browserContext.on(
    "targetcreated",
    runInLoggerContext(async (target) => {
      if (target.type() === TargetType.PAGE) {
        logger("Target created %o", target.type());
        const page = await target.page();
        if (!page) return;

        const userAgent = await page.evaluate(() => navigator.userAgent);
        const newUA = userAgent.replace("HeadlessChrome/", "Chrome/");
        logger("Replacing user agent", { userAgent, newUA });

        await page.setUserAgent(newUA);
        await page.setExtraHTTPHeaders({
          "accept-language": "en-US,en;q=0.9,he;q=0.8",
        });
        await page.evaluateOnNewDocument(() => {
          // Apply lightweight stealth patches before page scripts run.
          Object.defineProperty(navigator, "webdriver", {
            get: () => undefined,
          });
          Object.defineProperty(navigator, "language", {
            get: () => "en-US",
          });
          Object.defineProperty(navigator, "languages", {
            get: () => ["en-US", "en", "he"],
          });
        });

        page.on(
          "framenavigated",
          runInLoggerContext((frame) => {
            const url = frame.url();
            if (!url || url === "about:blank") return;
            logger("Frame navigated", {
              url,
              parentFrameUrl: frame.parentFrame()?.url(),
            });
            if (url.includes(cfParam)) {
              logger("Cloudflare challenge detected");
              solveTurnstile(page).then(
                (res) => {
                  logger(`Cloudflare challenge ended with ${res} for ${url}`);
                },
                (error) => {
                  logger(`Cloudflare challenge failed for ${url}`, error);
                },
              );
            }
          }, activeContext),
        );
      }
    }, activeContext),
  );
}
