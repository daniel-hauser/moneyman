import type { CompanyTypes } from "israeli-bank-scrapers";
import puppeteer, {
  TargetType,
  type Browser,
  type BrowserContext,
  type Page,
  type PuppeteerLaunchOptions,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createBrowser(): Promise<Browser> {
  const options = {
    args: browserArgs,
    executablePath: browserExecutablePath,
    // Hide the "Chrome is being controlled by automated software" marker.
    ignoreDefaultArgs: ["--enable-automation"],
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
  await initCloudflareSkipping(context);
  await initBannerDismissal(context);
  return context;
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

async function initBannerDismissal(browserContext: BrowserContext) {
  logger("Setting up banner dismissal");
  browserContext.on("targetcreated", async (target) => {
    if (target.type() === TargetType.PAGE) {
      const page = await target.page();
      if (!page) return;

      // Try to dismiss banner after page loads
      page.on("framenavigated", async (frame) => {
        const url = frame.url();
        if (!url || url === "about:blank") return;

        // Only handle main frame navigations
        if (frame.parentFrame()) return;

        // Wait a bit for the page to render
        try {
          await sleep(2000);
          await dismissPrivacyBanner(page);
        } catch (error) {
          // Silently fail - banner might not be present
          logger("Banner dismissal check failed (might not be present)", error);
        }
      });
    }
  });
}

async function dismissPrivacyBanner(page: Page): Promise<void> {
  try {
    // First, try to find by text content - this is the most reliable method
    const buttonFound = await page.evaluate(() => {
      // Look for buttons containing the dismiss text
      const buttons = Array.from(document.querySelectorAll('button, a'));
      for (const button of buttons) {
        const text = button.textContent?.trim() || '';
        if (text.includes('הבנתי') && text.includes('תודה')) {
          (button as HTMLElement).click();
          return true;
        }
      }
      return false;
    });

    if (buttonFound) {
      logger("Privacy banner dismissed using text search");
      await sleep(500); // Wait for modal to close
      return;
    }

    // Try finding cookie/privacy consent banners specifically
    const modalDismissed = await page.evaluate(() => {
      // Only target actual cookie/privacy consent banners, not login forms or other modals.
      // Use IDs/classes that are specific to consent banners to avoid false positives.
      const consentSelectors = [
        '[id*="cookie"]', '[id*="consent"]', '[id*="gdpr"]', '[id*="privacy"]',
        '[class*="cookie"]', '[class*="consent"]', '[class*="gdpr"]',
        '[aria-label*="cookie"]', '[aria-label*="consent"]',
      ];

      for (const selector of consentSelectors) {
        const banner = document.querySelector(selector);
        if (!banner) continue;

        const style = window.getComputedStyle(banner as Element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const buttons = banner.querySelectorAll('button, a[class*="button"], a[role="button"]');
        for (const button of Array.from(buttons).reverse()) {
          const text = button.textContent?.trim() || '';
          const className = button.className || '';

          if (text.includes('הבנתי') || text.includes('תודה') || text.includes('אישור') ||
            className.includes('close') || className.includes('dismiss') ||
            className.includes('accept') || className.includes('ok')) {
            (button as HTMLElement).click();
            return true;
          }
        }
      }
      return false;
    });

    if (modalDismissed) {
      logger("Privacy banner dismissed using consent banner detection");
      await sleep(500); // Wait for modal to close
      return;
    }

    logger("Privacy banner not found or already dismissed");
  } catch (error) {
    logger("Error dismissing privacy banner", error);
    // Don't throw - banner might not be present, and we don't want to break scraping
  }
}
