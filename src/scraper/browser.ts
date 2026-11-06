import type { CompanyTypes } from "israeli-bank-scrapers";
import puppeteer, {
  TargetType,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
} from "puppeteer";
import { createLogger } from "../utils/logger.js";
import { context } from "@opentelemetry/api";
import type { DomainTracker } from "../security/domains.js";
import { solveTurnstile } from "./cloudflareSolver.js";
import { createPuppeteerLogger } from "./puppeteerLogger.js";

export const browserArgs = [
  "--disable-dev-shm-usage",
  "--no-sandbox",
  // Reduce easy automation fingerprints used by anti-bot providers.
  "--disable-blink-features=AutomationControlled",
];
const logger = createLogger("browser");

export async function createBrowser(
  executablePath?: string,
  signal?: AbortSignal,
): Promise<Browser> {
  // The returned browser outlives this scope. Cleanup follows disconnect, not
  // function return or the cancellation request that starts browser shutdown.
  const lifetime = new AbortController();
  const logging = createPuppeteerLogger(lifetime.signal);
  const options = {
    args: browserArgs,
    executablePath: executablePath || undefined,
    signal,
    logger: logging.logger,
    // Hide the "Chrome is being controlled by automated software" marker.
    ignoreDefaultArgs: ["--enable-automation"],
  } satisfies LaunchOptions;

  logger("Launch options", options);
  try {
    const browser = await puppeteer.launch(options);
    browser.once("disconnected", () => lifetime.abort());
    return browser;
  } catch (error) {
    lifetime.abort();
    throw error;
  }
}

export async function createSecureBrowserContext(
  browser: Browser,
  companyId: CompanyTypes,
  initDomainTracking: DomainTracker["initDomainTracking"],
): Promise<BrowserContext> {
  const context = await browser.createBrowserContext();
  await initDomainTracking(context, companyId);
  await initCloudflareSkipping(context);
  return context;
}

async function initCloudflareSkipping(browserContext: BrowserContext) {
  const cfParam = "__cf_chl_rt_tk";

  browserContext.on(
    "targetcreated",
    context.bind(context.active(), async (target) => {
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
          context.bind(context.active(), (frame) => {
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
          }),
        );
      }
    }),
  );
}
