import { CompanyTypes } from "israeli-bank-scrapers";
import { mock, mockClear } from "jest-mock-extended";
import { type Browser, type BrowserContext, type Page } from "puppeteer";
import type { ScraperConfig } from "../types";

// Mock logger
const mockLogger = Object.assign(jest.fn(), {
  extend: jest.fn().mockReturnThis(),
});
jest.mock("../utils/logger.js", () => ({
  createLogger: jest.fn(() => mockLogger),
}));
jest.mock("../utils/asyncContext.js", () => ({
  loggerContextStore: {
    run: jest.fn((_ctx: unknown, fn: () => unknown) => fn()),
  },
}));

// Mock config with a mutable sameProviderDelayMs
const mockConfig = {
  options: {
    scraping: {
      sameProviderDelayMs: 30000,
    },
  },
};
jest.mock("../config.js", () => ({
  config: mockConfig,
}));

// Mock browser module
const mockPage = mock<Page>();
const mockContext = mock<BrowserContext>();
mockContext.newPage.mockResolvedValue(mockPage);
mockContext.close.mockResolvedValue(undefined);

const mockBrowser = mock<Browser>();

const mockCreateBrowser = jest.fn().mockResolvedValue(mockBrowser);
const mockCreateSecureBrowserContext = jest.fn().mockResolvedValue(mockContext);

jest.mock("./browser.js", () => ({
  createBrowser: mockCreateBrowser,
  createSecureBrowserContext: mockCreateSecureBrowserContext,
}));

// Mock scrape module
const mockGetAccountTransactions = jest.fn().mockResolvedValue({
  success: true,
  accounts: [],
});
jest.mock("./scrape.js", () => ({
  getAccountTransactions: mockGetAccountTransactions,
}));

// Mock failure screenshot
jest.mock("../utils/failureScreenshot.js", () => ({
  getFailureScreenShotPath: jest.fn(() => "/tmp/screenshot.png"),
}));

import { scrapeAccounts } from "./index";

describe("scrapeAccounts", () => {
  const makeConfig = (
    overrides: Partial<Pick<ScraperConfig, "accounts">> = {},
  ): ScraperConfig => ({
    accounts: overrides.accounts ?? [
      {
        companyId: CompanyTypes.hapoalim,
        username: "user",
        nationalID: "000000000",
        password: "pass",
      },
    ],
    startDate: new Date(),
    futureMonthsToScrape: 1,
    parallelScrapers: 1,
    additionalTransactionInformation: false,
    includeRawTransaction: false,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockClear(mockContext);
    mockClear(mockBrowser);
    mockClear(mockPage);
    mockContext.newPage.mockResolvedValue(mockPage);
    mockContext.close.mockResolvedValue(undefined);
    mockCreateBrowser.mockResolvedValue(mockBrowser);
    mockCreateSecureBrowserContext.mockResolvedValue(mockContext);
    mockGetAccountTransactions.mockResolvedValue({
      success: true,
      accounts: [],
    });
    mockConfig.options.scraping.sameProviderDelayMs = 30000;
  });

  it("should close browser context after scraping", async () => {
    await scrapeAccounts(makeConfig());
    expect(mockContext.close).toHaveBeenCalledTimes(1);
  });

  it("should close browser context even when scraping fails", async () => {
    mockGetAccountTransactions.mockRejectedValueOnce(
      new Error("scrape failed"),
    );

    await expect(scrapeAccounts(makeConfig())).rejects.toThrow();

    expect(mockContext.close).toHaveBeenCalledTimes(1);
  });

  it("should log and forward to onError when context close fails", async () => {
    const closeError = new Error("close failed");
    mockContext.close.mockRejectedValueOnce(closeError);
    const onError = jest.fn();

    await scrapeAccounts(makeConfig(), undefined, onError);

    expect(mockLogger).toHaveBeenCalledWith(
      "Failed to close browser context",
      closeError,
    );
    expect(onError).toHaveBeenCalledWith(closeError, "browserContext.close");
  });

  it("should not delay for a single account", async () => {
    jest.useFakeTimers();

    const promise = scrapeAccounts(makeConfig());
    await jest.runAllTimersAsync();
    await promise;

    expect(mockLogger).not.toHaveBeenCalledWith(
      "Delaying %dms before next %s account",
      expect.anything(),
      expect.anything(),
    );

    jest.useRealTimers();
  });

  it("should not delay for different providers", async () => {
    jest.useFakeTimers();

    const promise = scrapeAccounts(
      makeConfig({
        accounts: [
          {
            companyId: CompanyTypes.hapoalim,
            username: "user1",
            nationalID: "000000001",
            password: "pass1",
          },
          {
            companyId: CompanyTypes.leumi,
            username: "user2",
            nationalID: "000000002",
            password: "pass2",
          },
        ],
      }),
    );

    await jest.runAllTimersAsync();
    await promise;

    expect(mockLogger).not.toHaveBeenCalledWith(
      "Delaying %dms before next %s account",
      expect.anything(),
      expect.anything(),
    );

    jest.useRealTimers();
  });

  it("should delay between consecutive accounts with the same provider", async () => {
    jest.useFakeTimers();

    const promise = scrapeAccounts(
      makeConfig({
        accounts: [
          {
            companyId: CompanyTypes.hapoalim,
            username: "user1",
            nationalID: "000000001",
            password: "pass1",
          },
          {
            companyId: CompanyTypes.hapoalim,
            username: "user2",
            nationalID: "000000002",
            password: "pass2",
          },
        ],
      }),
    );

    await jest.runAllTimersAsync();
    await promise;

    expect(mockLogger).toHaveBeenCalledWith(
      "Delaying %dms before next %s account",
      30000,
      CompanyTypes.hapoalim,
    );

    jest.useRealTimers();
  });

  it("should not delay when sameProviderDelayMs is 0", async () => {
    mockConfig.options.scraping.sameProviderDelayMs = 0;
    jest.useFakeTimers();

    const promise = scrapeAccounts(
      makeConfig({
        accounts: [
          {
            companyId: CompanyTypes.hapoalim,
            username: "user1",
            nationalID: "000000001",
            password: "pass1",
          },
          {
            companyId: CompanyTypes.hapoalim,
            username: "user2",
            nationalID: "000000002",
            password: "pass2",
          },
        ],
      }),
    );

    await jest.runAllTimersAsync();
    await promise;

    expect(mockLogger).not.toHaveBeenCalledWith(
      "Delaying %dms before next %s account",
      expect.anything(),
      expect.anything(),
    );

    jest.useRealTimers();
  });
});
