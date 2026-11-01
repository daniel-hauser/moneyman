import debug from "debug";
import assert from "node:assert/strict";
import test, { before, after, describe } from "node:test";
import { CompanyTypes, createScraper } from "israeli-bank-scrapers";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";
import {
  createBrowser,
  createSecureBrowserContext,
} from "./scraper/browser.js";
import { createLogger } from "./utils/logger.js";
import { getExternalIp } from "./runnerMetadata.js";
import { scraperOptions } from "./scraper/index.js";
import { config } from "./config.js";
import { createDomainTracker } from "./security/domains.js";

const logger = createLogger("test-scraper-access");

const firewallSettings = [
  ...["amex", "isracard", "visaCal"].flatMap((company) =>
    [
      "doubleclick.net",
      "googletagmanager.com",
      "google.com",
      "instagram.com",
    ].map((domain) => `${company} BLOCK ${domain}`),
  ),
];

const domainTracker = createDomainTracker({
  domainTracking: true,
  firewallSettings,
  blockByDefault: config.options.security.blockByDefault,
});

debug.enable(
  "moneyman:browser,moneyman:test-scraper-access,moneyman:cloudflare-solver,moneyman:domain-rules,israeli-bank-scrapers:*",
);

describe("Sites access tests", () => {
  let browser: Awaited<ReturnType<typeof createBrowser>>;

  before(async () => {
    logger("Starting tests");
    logger("Connecting from: ", await getExternalIp());
    browser = await createBrowser(
      config.options.scraping.puppeteerExecutablePath,
    );
  });

  after(async () => {
    try {
      await browser?.close();
    } finally {
      domainTracker.dispose();
    }
  });

  describe("scraper access", () => {
    for (const companyId of [
      CompanyTypes.amex,
      CompanyTypes.isracard,
      CompanyTypes.visaCal,
    ] as const) {
      test(`Can start scraping ${companyId}`, async () => {
        const credentials =
          companyId === CompanyTypes.visaCal
            ? { username: "123456", password: "1234" }
            : { card6Digits: "123456", id: "123456789", password: "1234" };
        const scraper = createScraper({
          companyId,
          startDate: new Date(),
          // Safe to remove when israeli-bank-scrapers upgrades to puppeteer 25+
          browserContext: (await createSecureBrowserContext(
            browser,
            companyId,
            domainTracker.initDomainTracking,
          )) as any,
          ...scraperOptions,
        });

        const result = await scraper.scrape(credentials);

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.errorType, ScraperErrorTypes.InvalidPassword);
      });
    }
  });
});
