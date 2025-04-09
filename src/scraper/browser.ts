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
  const cfParam = "__cf_chl_rt_tk";

  browserContext.on("targetcreated", async (target) => {
    if (target.type() === TargetType.PAGE) {
      const page = await target.page();
      page?.on("framenavigated", (frame) => {
        const url = frame.url();
        logToMetadataFile(
          `Frame navigated: ${frame.url()}, parent=${frame.parentFrame()?.url() ?? "none"}`,
        );
        if (url.includes(cfParam)) {
          logToMetadataFile(`Cloudflare challenge detected`);
          solveTurnstile(page).then((res) =>
            logToMetadataFile(
              `Cloudflare challenge ended with ${res} for ${url}`,
            ),
          );
        }
      });
    }
  });
}
