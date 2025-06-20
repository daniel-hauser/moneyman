import debug from "debug";
import { CompanyTypes, createScraper } from "israeli-bank-scrapers";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";
import {
  createBrowser,
  createSecureBrowserContext,
} from "./scraper/browser.js";
import { createLogger } from "./utils/logger.js";
import { getExternalIp } from "./runnerMetadata.js";
import { scraperOptions } from "./scraper/index.js";

const logger = createLogger("test-scraper-access");

jest.mock("./config.js", () => ({
  config: {
    options: {
      scraping: {
        domainTracking: true,
      },
      security: {
        firewallSettings: [
          ...["amex", "isracard"].flatMap((c) =>
            [
              "doubleclick.net",
              "googletagmanager.com",
              "google.com",
              "instagram.com",
            ].map((d) => `${c} BLOCK ${d}`),
          ),
        ],
      },
    },
  },
}));

debug.enable(
  "moneyman:browser,moneyman:test-scraper-access,moneyman:cloudflare-solver,moneyman:domain-rules,israeli-bank-scrapers:*",
);

describe("Sites access tests", () => {
  let browser: Awaited<ReturnType<typeof createBrowser>>;

  beforeAll(async () => {
    logger("Starting tests");
    logger("Connecting from: ", await getExternalIp());
    browser = await createBrowser();
  });

  afterAll(async () => {
    await browser.close();
  });

  test.each([
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
  ])(
    "should access $company at $url",
    async ({ company, url, title, expectedText }) => {
      expect(browser).toBeDefined();
      const context = await createSecureBrowserContext(browser, company);
      const page = await context.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
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
      expect(pageTitle).toContain(title);

      const textFound = await page
        .mainFrame()
        .evaluate(
          (expectedText) => document.body.innerText.includes(expectedText),
          expectedText,
        );
      expect(textFound).toBeTruthy();
    },
  );

  test.each([CompanyTypes.amex, CompanyTypes.isracard])(
    "Can start scraping %s",
    async (companyId) => {
      const scraper = createScraper({
        companyId,
        startDate: new Date(),
        browserContext: await createSecureBrowserContext(browser, companyId),
        ...scraperOptions,
      });

      const result = await scraper.scrape({
        card6Digits: "123456",
        id: "123456789",
        password: "1234",
      });

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          errorType: ScraperErrorTypes.InvalidPassword,
        }),
      );
    },
  );
});
