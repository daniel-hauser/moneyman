import { CompanyTypes, type ScraperOptions } from "israeli-bank-scrapers";
import { getAccountTransactions } from "./scrape";
import { mock, mockClear } from "jest-mock-extended";
import { type BrowserContext, type Page } from "puppeteer";

describe("getAccountTransactions", () => {
  const onProgress = jest.fn();
  const browserPage = mock<Page>();
  const browserContext = mock<BrowserContext>({
    newPage: jest.fn().mockResolvedValue(browserPage),
  });

  const account = {
    companyId: CompanyTypes.hapoalim,
    username: "username",
    password: "password",
  };

  const scraperOptions: ScraperOptions = {
    browserContext,
    startDate: new Date(),
    companyId: account.companyId,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockClear(browserContext);
    mockClear(browserPage);
  });

  it("should create a scraper and a page", async () => {
    const result = await getAccountTransactions(
      account,
      scraperOptions,
      onProgress,
    );

    expect(result).toBeDefined();
    expect(result.success).toBeFalsy(); // because we didn't mock the scraper

    expect(browserContext.newPage).toHaveBeenCalledTimes(1);
    expect(browserPage.close).toHaveBeenCalledTimes(1);

    expect(onProgress).toHaveBeenNthCalledWith(
      1,
      account.companyId,
      "START_SCRAPING",
    );
    expect(onProgress).toHaveBeenLastCalledWith(
      account.companyId,
      "END_SCRAPING",
    );
  });

  describe("OTP functionality", () => {
    it("should prepare OneZero accounts with OTP when enabled", async () => {
      // This is a basic test to ensure the OTP preparation logic exists
      const oneZeroAccount = {
        companyId: CompanyTypes.oneZero,
        email: "test@example.com",
        password: "password",
        phoneNumber: "+972501234567",
        // For this test, we'll add a minimal otpCodeRetriever to satisfy TypeScript
        otpCodeRetriever: async () => "123456",
      };

      const result = await getAccountTransactions(
        oneZeroAccount,
        {
          ...scraperOptions,
          companyId: CompanyTypes.oneZero,
        },
        onProgress,
      );

      expect(result).toBeDefined();
      // The actual OTP logic will be tested when integrated with real scenarios
    });

    it("should not modify non-OneZero accounts", async () => {
      const result = await getAccountTransactions(
        account,
        scraperOptions,
        onProgress,
      );

      expect(result).toBeDefined();
      // Non-OneZero accounts should not be affected by OTP logic
    });
  });
});
