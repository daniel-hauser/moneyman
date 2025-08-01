import type { CompanyTypes } from "israeli-bank-scrapers";
import puppeteer, {
  TargetType,
  type Browser,
  type BrowserContext,
  type PuppeteerLaunchOptions,
} from "puppeteer";
import { createLogger, logToMetadataFile } from "../utils/logger.js";
import { initDomainTracking } from "../security/domains.js";
import { solveTurnstile } from "./cloudflareSolver.js";
import { config } from "../config.js";

export const browserArgs = ["--disable-dev-shm-usage", "--no-sandbox"];
export const browserExecutablePath =
  config.options.scraping.puppeteerExecutablePath || undefined;

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
  await initCloudflareSkipping(context);
  return context;
}

async function initCloudflareSkipping(browserContext: BrowserContext) {
  const cfParam = "__cf_chl_rt_tk";

  logger("Setting up Cloudflare skipping");
  browserContext.on("targetcreated", async (target) => {
    if (target.type() === TargetType.PAGE) {
      logger("Target created %o", target.type());
      const page = await target.page();
      if (!page) return;

      const userAgent = await page.evaluate(() => navigator.userAgent);
      const newUA = userAgent.replace("HeadlessChrome/", "Chrome/");
      logger("Replacing user agent", { userAgent, newUA });
      await page.setUserAgent(newUA);

      page.on("framenavigated", (frame) => {
        const url = frame.url();
        if (!url || url === "about:blank") return;
        logger("Frame navigated", {
          url,
          parentFrameUrl: frame.parentFrame()?.url(),
        });
        logToMetadataFile(`Frame navigated: ${frame.url()}`);
        if (url.includes(cfParam)) {
          logger("Cloudflare challenge detected");
          logToMetadataFile(`Cloudflare challenge detected`);
          solveTurnstile(page).then(
            (res) => {
              logger(`Cloudflare challenge ended with ${res} for ${url}`);
              logToMetadataFile(
                `Cloudflare challenge ended with ${res} for ${url}`,
              );
            },
            (error) => {
              logger(`Cloudflare challenge failed for ${url}`, error);
              logToMetadataFile(`Cloudflare challenge failed for ${url}`);
            },
          );
        }
      });
    }
  });
}
