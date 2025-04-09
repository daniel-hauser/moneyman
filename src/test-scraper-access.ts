import debug from "debug";
import assert from "node:assert";
import { describe, after, afterEach, test } from "node:test";
import type { Page } from "puppeteer";
import { CompanyTypes } from "israeli-bank-scrapers";
import {
  createBrowser,
  createSecureBrowserContext,
} from "./scraper/browser.js";
import { sleep } from "./utils/utils.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("test-scraper-access");

debug.enable(
  "moneyman:browser,moneyman:test-scraper-access,moneyman:cloudflare-solver",
);

const sitesToCheck: Array<{
  url: string;
  title: string;
  expectedText: string;
  company: CompanyTypes;
}> = [
  {
    url: "https://digital.isracard.co.il",
    title: "ישראכרט",
    expectedText: "ישראכרט",
    company: CompanyTypes.isracard,
  },
];

describe("Scraper access tests", async () => {
  const browser = await createBrowser();
  after(() => browser.close());

  let page: Page;
  afterEach(async () => {
    if (page) {
      logger("afterEach: ", page.url(), page.title());
      await page.screenshot({
        path: `./screenshot_${new Date().toISOString().replace(/:/g, "-")}.png`,
      });
      await page.close();
    }
  });

  for (const { company, url, title, expectedText } of sitesToCheck) {
    test(`should access ${company} at ${url}`, async () => {
      assert.ok(browser, "Browser should be created");
      const context = await createSecureBrowserContext(browser, company);
      page = await context.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      logger("Page created");
      await sleep(1000);
      await page.goto(url, { waitUntil: "networkidle2" });
      logger("Page loaded", page.url());

      const pageTitle = await page.title();
      logger("Page title", pageTitle);
      assert.ok(
        pageTitle.includes(title),
        `Title should have ${title}, actual: ${pageTitle}`,
      );

      await page.waitForNetworkIdle();

      const textFound = await page
        .mainFrame()
        .evaluate(
          (expectedText) => document.body.innerText.includes(expectedText),
          expectedText,
        );
      assert.ok(textFound, `Text should be found: ${expectedText}`);
    });
  }
});
