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
  await initCloudflareSkipping(context);
  return context;
}

async function initCloudflareSkipping(browserContext: BrowserContext) {
  browserContext.on("targetcreated", async (target) => {
    if (target.type() === TargetType.PAGE) {
      const page = await target.page();
      page?.on("framenavigated", (frame) => {
        logToMetadataFile(`Frame navigated: ${frame.url()}`);
        const frameUrl = frame.url();
        if (!frameUrl || frameUrl === "about:blank") {
          return;
        }
        const url = new URL(frameUrl);
        const cfParam = "__cf_chl_rt_tk__";
        if (url.searchParams.has(cfParam)) {
          logToMetadataFile(`Detected Cloudflare challenge ${url}`);
          solveTurnstile(page).then((res) => {
            logToMetadataFile(
              `Cloudflare challenge ended with ${res} for ${url}`,
            );
          });
        } else if (
          Array.from(url.searchParams.keys()).some((k) => k.startsWith("__cf"))
        ) {
          logToMetadataFile(
            `Detected unsupported Cloudflare challenge: ${url.search}`,
          );
        }
      });
    }
  });
}
