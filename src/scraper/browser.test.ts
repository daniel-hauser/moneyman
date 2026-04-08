import { jest } from "@jest/globals";
import { CompanyTypes } from "israeli-bank-scrapers";
import { BrowserContext, Browser, Page } from "puppeteer";
import { mock } from "jest-mock-extended";

jest.mock("../utils/logger.js", () => ({
  createLogger: jest.fn(() => jest.fn()),
}));

jest.mock("../utils/asyncContext.js", () => ({
  runInLoggerContext: jest.fn((fn: Function) => fn),
  loggerContextStore: { getStore: jest.fn() },
}));

jest.mock("../security/domains.js", () => ({
  initDomainTracking: jest.fn(),
}));

jest.mock("./cloudflareSolver.js", () => ({
  solveTurnstile: jest.fn(),
}));

describe("browser", () => {
  let browser: ReturnType<typeof mock<Browser>>;
  let context: ReturnType<typeof mock<BrowserContext>>;
  let page: ReturnType<typeof mock<Page>>;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.resetModules();
    delete process.env.MONEYMAN_BROWSER_COOKIES;

    browser = mock<Browser>();
    context = mock<BrowserContext>();
    page = mock<Page>();

    browser.createBrowserContext.mockResolvedValue(context);
    context.newPage.mockResolvedValue(page);
    page.setCookie.mockResolvedValue(undefined);
    page.close.mockResolvedValue(undefined);
  });

  function mockConfig(overrides: Record<string, unknown> = {}) {
    jest.mock("../config.js", () => ({
      config: {
        options: {
          scraping: {
            puppeteerExecutablePath: undefined,
            ...overrides,
          },
        },
      },
    }));
  }

  describe("injectCookiesFromEnv (via createSecureBrowserContext)", () => {
    it("does nothing when MONEYMAN_BROWSER_COOKIES is unset", async () => {
      mockConfig();
      const { createSecureBrowserContext } = await import("./browser.js");

      await createSecureBrowserContext(browser, CompanyTypes.hapoalim);

      expect(context.newPage).not.toHaveBeenCalled();
    });

    it("parses keyed format and injects cookies for matching companyId", async () => {
      const cookies = [
        { name: "session", value: "abc123", domain: ".bank.co.il" },
      ];
      process.env.MONEYMAN_BROWSER_COOKIES = JSON.stringify({
        [CompanyTypes.hapoalim]: cookies,
      });
      mockConfig();
      const { createSecureBrowserContext } = await import("./browser.js");

      await createSecureBrowserContext(browser, CompanyTypes.hapoalim);

      expect(context.newPage).toHaveBeenCalled();
      expect(page.setCookie).toHaveBeenCalledWith(...cookies);
      expect(page.close).toHaveBeenCalled();
    });

    it("skips injection when companyId has no cookies in keyed format", async () => {
      process.env.MONEYMAN_BROWSER_COOKIES = JSON.stringify({
        [CompanyTypes.hapoalim]: [
          { name: "session", value: "abc123", domain: ".bank.co.il" },
        ],
      });
      mockConfig();
      const { createSecureBrowserContext } = await import("./browser.js");

      await createSecureBrowserContext(browser, CompanyTypes.leumi);

      expect(context.newPage).not.toHaveBeenCalled();
    });

    it("handles invalid JSON gracefully", async () => {
      process.env.MONEYMAN_BROWSER_COOKIES = "not-json{";
      mockConfig();
      const { createSecureBrowserContext } = await import("./browser.js");

      // Should not throw
      await createSecureBrowserContext(browser, CompanyTypes.hapoalim);

      expect(context.newPage).not.toHaveBeenCalled();
    });

    it("handles empty cookie array", async () => {
      process.env.MONEYMAN_BROWSER_COOKIES = JSON.stringify({
        [CompanyTypes.hapoalim]: [],
      });
      mockConfig();
      const { createSecureBrowserContext } = await import("./browser.js");

      await createSecureBrowserContext(browser, CompanyTypes.hapoalim);

      expect(context.newPage).not.toHaveBeenCalled();
    });
  });
});
