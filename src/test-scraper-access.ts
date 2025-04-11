import debug from "debug";
import assert from "node:assert";
import { describe, after, test } from "node:test";
import { CompanyTypes } from "israeli-bank-scrapers";
import {
  createBrowser,
  createSecureBrowserContext,
} from "./scraper/browser.js";
import { sleep } from "./utils/utils.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("test-scraper-access");

process.env.DOMAIN_TRACKING_ENABLED = "1";
process.env.FIREWALL_SETTINGS = [
  ...["amex", "isracard"].flatMap((c) =>
    ["doubleclick.net", "googletagmanager.com"].map(
      () => `${c} BLOCK doubleclick.net`,
    ),
  ),
].join("|");

debug.enable(
  "moneyman:browser,moneyman:test-scraper-access,moneyman:cloudflare-solver,moneyman:domain-rules",
);

type SiteTest = {
  url: string;
  title: string;
  expectedText: string;
  company: CompanyTypes;
};

const sitesToCheck: Array<SiteTest> = [
  {
    url: "https://login.bankhapoalim.co.il",
    title: "בנק הפועלים",
    expectedText: "כניסה לחשבונך",
    company: CompanyTypes.hapoalim,
  },
  {
    url: "https://digital.isracard.co.il",
    title: "ישראכרט",
    expectedText: "ישראכרט",
    company: CompanyTypes.isracard,
  },
  {
    url: "https://he.americanexpress.co.il",
    title: "אמריקן אקספרס",
    expectedText: "אמריקן אקספרס",
    company: CompanyTypes.amex,
  },
];

describe("Scraper access tests", async () => {
  const browser = await createBrowser();
  after(() => browser.close());

  for (const { company, url, title, expectedText } of sitesToCheck) {
    test(`should access ${company} at ${url}`, async () => {
      assert.ok(browser, "Browser should be created");
      const context = await createSecureBrowserContext(browser, company);
      const page = await context.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      logger("Page created");
      await sleep(1000);
      await page.goto(url, { waitUntil: "networkidle2" });
      logger("Page loaded", page.url());

      const initialPageTitle = await page.title();
      if (!initialPageTitle.includes(title)) {
        logger(
          `Page title does not yet match, waiting for navigation. was ${initialPageTitle}`,
        );
        logger("content=", await page.content());
        await page.waitForNavigation({
          waitUntil: "networkidle2",
          timeout: 55_000,
        });
      }

      const pageTitle = await page.title();
      logger("Page title", pageTitle);
      assert.ok(
        pageTitle.includes(title),
        `Title should have ${title}, actual: ${pageTitle}`,
      );

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
