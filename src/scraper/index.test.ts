import { mock } from "jest-mock-extended";
import type { Browser } from "puppeteer";
import { CompanyTypes } from "israeli-bank-scrapers";
import { scrapeAccounts } from "./index.js";
import { createBrowser, createSecureBrowserContext } from "./browser.js";
import { getAccountTransactions } from "./scrape.js";
import type { ScraperConfig } from "../types.js";

jest.mock("./browser.js", () => ({
  createBrowser: jest.fn(),
  createSecureBrowserContext: jest.fn(),
}));
jest.mock("./scrape.js", () => ({ getAccountTransactions: jest.fn() }));
jest.mock("../utils/failureScreenshot.js", () => ({
  getFailureScreenShotPath: jest.fn(() => "failure.png"),
}));

const config: ScraperConfig = {
  accounts: [
    {
      companyId: CompanyTypes.hapoalim,
      userCode: "user",
      password: "password",
    },
  ],
  startDate: new Date("2026-01-01T00:00:00Z"),
  futureMonthsToScrape: 1,
  parallelScrapers: 1,
  additionalTransactionInformation: true,
  includeRawTransaction: true,
};

describe("scraper runtime browser lifecycle", () => {
  const browser = mock<Browser>();
  const initDomainTracking = jest.fn(async () => {});
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    browser[Symbol.asyncDispose].mockResolvedValue(undefined);
    jest.mocked(createBrowser).mockResolvedValue(browser);
    jest.mocked(createSecureBrowserContext).mockResolvedValue(mock());
    jest
      .mocked(getAccountTransactions)
      .mockResolvedValue({ success: true, accounts: [] });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("passes narrow browser/OTP settings and closes the browser before returning results", async () => {
    const requestOtpCode = jest.fn();
    const results = await scrapeAccounts(
      config,
      initDomainTracking,
      undefined,
      undefined,
      {
        executablePath: "browser",
        requestOtpCode,
      },
    );
    expect(results).toEqual([
      { companyId: "hapoalim", result: { success: true, accounts: [] } },
    ]);
    expect(createBrowser).toHaveBeenCalledWith("browser", undefined);
    expect(getAccountTransactions).toHaveBeenCalledWith(
      config.accounts[0],
      expect.objectContaining({
        includeRawTransaction: true,
        additionalTransactionInformation: true,
      }),
      expect.any(Function),
      requestOtpCode,
    );
    expect(browser[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
    expect(createSecureBrowserContext).toHaveBeenCalledWith(
      browser,
      CompanyTypes.hapoalim,
      initDomainTracking,
    );
  });

  it("closes the browser when context setup fails", async () => {
    jest
      .mocked(createSecureBrowserContext)
      .mockRejectedValueOnce(new Error("context failed"));
    await expect(scrapeAccounts(config, initDomainTracking)).rejects.toThrow(
      "context failed",
    );
    expect(browser[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it("closes a browser created after the worker starts shutting down", async () => {
    const abort = new AbortController();
    jest.mocked(createBrowser).mockImplementationOnce(async () => {
      abort.abort(new Error("worker stopped during startup"));
      return browser;
    });
    await expect(
      scrapeAccounts(config, initDomainTracking, undefined, undefined, {
        signal: abort.signal,
      }),
    ).rejects.toThrow("worker stopped during startup");
    expect(browser[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
    expect(getAccountTransactions).not.toHaveBeenCalled();
  });

  it("does not launch a browser for an already-cancelled run", async () => {
    const abort = new AbortController();
    abort.abort(new Error("worker already cancelled"));
    await expect(
      scrapeAccounts(config, initDomainTracking, undefined, undefined, {
        signal: abort.signal,
      }),
    ).rejects.toThrow("worker already cancelled");
    expect(createBrowser).not.toHaveBeenCalled();
  });

  it("passes cancellation to the launcher and disposes the browser once", async () => {
    const abort = new AbortController();
    jest.mocked(getAccountTransactions).mockImplementationOnce(async () => {
      abort.abort(new Error("worker cancelled"));
      return { success: false };
    });
    await expect(
      scrapeAccounts(config, initDomainTracking, undefined, undefined, {
        signal: abort.signal,
      }),
    ).rejects.toThrow("worker cancelled");
    expect(createBrowser).toHaveBeenCalledWith(undefined, abort.signal);
    expect(browser[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it("does not abort the caller's signal on success", async () => {
    const abort = new AbortController();
    await scrapeAccounts(config, initDomainTracking, undefined, undefined, {
      signal: abort.signal,
    });
    expect(abort.signal.aborted).toBe(false);
  });

  it("does not start queued accounts after cancellation", async () => {
    const abort = new AbortController();
    jest.mocked(getAccountTransactions).mockImplementationOnce(async () => {
      abort.abort(new Error("worker cancelled"));
      return { success: false };
    });

    await expect(
      scrapeAccounts(
        { ...config, accounts: [...config.accounts, ...config.accounts] },
        initDomainTracking,
        undefined,
        undefined,
        { signal: abort.signal },
      ),
    ).rejects.toThrow("worker cancelled");

    expect(createSecureBrowserContext).toHaveBeenCalledTimes(1);
    expect(getAccountTransactions).toHaveBeenCalledTimes(1);
    expect(browser[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it("awaits browser disposal before completing a cancelled scrape", async () => {
    const abort = new AbortController();
    const started = Promise.withResolvers<void>();
    const closing = Promise.withResolvers<void>();
    browser[Symbol.asyncDispose].mockReturnValueOnce(closing.promise);
    jest.mocked(getAccountTransactions).mockImplementationOnce(async () => {
      abort.abort(new Error("worker cancelled"));
      started.resolve();
      return { success: false };
    });
    const run = scrapeAccounts(
      config,
      initDomainTracking,
      undefined,
      undefined,
      {
        signal: abort.signal,
      },
    );
    const completed = jest.fn();
    void run.then(completed, completed);
    await started.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(browser[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
    expect(completed).not.toHaveBeenCalled();
    closing.resolve();
    await expect(run).rejects.toThrow("worker cancelled");
    expect(browser[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it("reports disposal failure after cancellation and scraping unwind", async () => {
    const abort = new AbortController();
    const started = Promise.withResolvers<void>();
    const finished =
      Promise.withResolvers<
        Awaited<ReturnType<typeof getAccountTransactions>>
      >();
    const failure = new Error("early browser close failed");
    const onError = jest.fn(async () => {});
    browser[Symbol.asyncDispose].mockRejectedValueOnce(failure);
    jest.mocked(getAccountTransactions).mockImplementationOnce(async () => {
      abort.abort(new Error("worker cancelled"));
      started.resolve();
      return finished.promise;
    });
    const run = scrapeAccounts(config, initDomainTracking, undefined, onError, {
      signal: abort.signal,
    });
    const rejected = expect(run).rejects.toThrow("worker cancelled");
    await started.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(browser[Symbol.asyncDispose]).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    finished.resolve({ success: false });
    await rejected;
    expect(onError).toHaveBeenCalledWith(failure, "browser.close");
    expect(browser[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "preserves the scrape outcome when reporting a close failure also fails (scrape failed: %s)",
    async (scrapeFailed) => {
      const scrapeError = new Error("context failed");
      const closeError = new Error("close failed");
      browser[Symbol.asyncDispose].mockRejectedValueOnce(closeError);
      if (scrapeFailed) {
        jest
          .mocked(createSecureBrowserContext)
          .mockRejectedValueOnce(scrapeError);
      }
      const onError = jest.fn().mockRejectedValue(new Error("report failed"));
      const run = scrapeAccounts(
        config,
        initDomainTracking,
        undefined,
        onError,
      );

      if (scrapeFailed) {
        await expect(run).rejects.toBe(scrapeError);
      } else {
        await expect(run).resolves.toHaveLength(1);
      }
      expect(onError).toHaveBeenCalledWith(closeError, "browser.close");
      expect(browser[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    "bounds a stalled close-warning callback without changing the scrape outcome (scrape failed: %s)",
    async (scrapeFailed) => {
      const deadline = new AbortController();
      const timeout = jest
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(deadline.signal);
      const reporting = Promise.withResolvers<void>();
      const scrapeError = new Error("context failed");
      browser[Symbol.asyncDispose].mockRejectedValueOnce(
        new Error("close failed"),
      );
      if (scrapeFailed) {
        jest
          .mocked(createSecureBrowserContext)
          .mockRejectedValueOnce(scrapeError);
      }
      const onError = jest.fn(() => {
        reporting.resolve();
        return new Promise<void>(() => {});
      });
      const run = scrapeAccounts(
        config,
        initDomainTracking,
        undefined,
        onError,
      );
      const outcome = scrapeFailed
        ? expect(run).rejects.toBe(scrapeError)
        : expect(run).resolves.toHaveLength(1);
      await reporting.promise;
      deadline.abort(new Error("warning deadline"));

      await outcome;
      expect(timeout).toHaveBeenCalledWith(3_000);
      expect(browser[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
    },
  );

  it("reports close failures while preserving results", async () => {
    browser[Symbol.asyncDispose].mockRejectedValueOnce(
      new Error("close failed"),
    );
    const onError = jest.fn();
    await expect(
      scrapeAccounts(config, initDomainTracking, undefined, onError),
    ).resolves.toHaveLength(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "close failed" }),
      "browser.close",
    );
  });
});
