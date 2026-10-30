import { EventEmitter, getEventListeners } from "node:events";
import { Worker, type MessagePort } from "node:worker_threads";
import { finalizer, releaseProxy, wrap, type Remote } from "comlink";
import { mock } from "jest-mock-extended";
import type { AccountScrapeResult, ScraperConfig } from "../types.js";
import { CompanyTypes } from "israeli-bank-scrapers";
import { scrapeAccounts } from "./client.js";
import { requestOtpCode } from "../bot/notifier.js";
import { formatUnknownError } from "../utils/utils.js";
import type {
  ScraperWorkerApi,
  WorkerCallbacks,
  WorkerResult,
  ScraperRunConfig,
} from "./protocol.js";

jest.mock("node:worker_threads", () => ({
  ...jest.requireActual("node:worker_threads"),
  Worker: jest.fn(),
}));
jest.mock("comlink", () => ({
  ...jest.requireActual("comlink"),
  wrap: jest.fn(),
}));
jest.mock("../bot/notifier.js", () => ({ requestOtpCode: jest.fn() }));

const scraping: ScraperRunConfig = {
  accounts: [
    {
      companyId: CompanyTypes.oneZero,
      email: "bank-user",
      password: "bank-password",
      phoneNumber: "+97200000000",
    } as ScraperConfig["accounts"][number],
  ],
  startDate: new Date("2026-01-01T00:00:00Z"),
  futureMonthsToScrape: 1,
  parallelScrapers: 1,
  additionalTransactionInformation: false,
  includeRawTransaction: true,
  executablePath: "browser",
  domainTracking: true,
  firewallSettings: ["oneZero ALLOW bank.test"],
  blockByDefault: true,
  enableOtp: true,
};
const results: AccountScrapeResult[] = [
  { companyId: CompanyTypes.oneZero, result: { success: true, accounts: [] } },
];
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("Comlink scraper client", () => {
  let worker: ReturnType<typeof mock<Worker>>;
  let api: ReturnType<typeof mock<Remote<ScraperWorkerApi>>>;
  let events: EventEmitter;
  const processEvents = ["SIGINT", "SIGTERM", "error"] as const;
  let processListeners: number[];
  const callbacks = () =>
    api.scrape.mock.calls.at(-1)![1] as unknown as WorkerCallbacks & {
      [finalizer](): void;
    };

  beforeEach(() => {
    jest.clearAllMocks();
    processListeners = processEvents.map((event) =>
      process.listenerCount(event),
    );
    events = new EventEmitter();
    worker = mock<Worker>();
    worker.once.mockImplementation((event, listener) => {
      events.once(event, listener);
      return worker;
    });
    worker.removeListener.mockImplementation((event, listener) => {
      events.removeListener(event, listener);
      return worker;
    });
    worker.terminate.mockImplementation(async () => {
      events.emit("exit", 0);
      return 0;
    });
    jest.mocked(Worker).mockImplementation(() => worker);
    api = mock<Remote<ScraperWorkerApi>>({
      [releaseProxy]: jest.fn(() => {
        (
          jest.mocked(wrap).mock.calls.at(-1)![0] as unknown as MessagePort
        ).close();
        (
          jest.mocked(Worker).mock.calls.at(-1)![1]!.workerData as MessagePort
        ).close();
      }),
    });
    jest.mocked(wrap<ScraperWorkerApi>).mockReturnValue(api);
    api.cancel.mockResolvedValue(undefined);
    api.scrape.mockImplementation(async () => {
      await tick();
      callbacks()[finalizer]();
      return { results, domains: {} };
    });
    jest.mocked(requestOtpCode).mockResolvedValue("123456");
  });

  afterEach(() => {
    expect(processEvents.map((event) => process.listenerCount(event))).toEqual(
      processListeners,
    );
    expect(events.listenerCount("exit")).toBe(0);
    expect(events.listenerCount("error")).toBe(0);
  });

  it("propagates synchronous worker construction failures without installing listeners", async () => {
    const closed = Promise.withResolvers<void>();
    jest.mocked(Worker).mockImplementationOnce((_file, options) => {
      options!.workerData.once("close", closed.resolve);
      throw new Error("worker construction failed");
    });
    await expect(scrapeAccounts(scraping)).rejects.toThrow(
      "worker construction failed",
    );
    await closed.promise;
    expect(wrap).not.toHaveBeenCalled();
  });

  it("terminates the worker and closes its ports when Comlink setup throws", async () => {
    const closed = Promise.withResolvers<void>();
    jest.mocked(wrap).mockImplementationOnce((endpoint) => {
      endpoint.addEventListener("close", () => closed.resolve());
      throw new Error("Comlink setup failed");
    });
    await expect(scrapeAccounts(scraping)).rejects.toThrow(
      "Comlink setup failed",
    );
    await closed.promise;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it("releases the API and worker if starting the scrape throws synchronously", async () => {
    api.scrape.mockImplementationOnce(() => {
      throw new Error("scrape dispatch failed");
    });
    await expect(scrapeAccounts(scraping)).rejects.toThrow(
      "scrape dispatch failed",
    );
    expect(api[releaseProxy]).toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it("does not construct a worker when the caller already cancelled", async () => {
    const abort = new AbortController();
    abort.abort(new Error("caller cancelled"));
    await expect(
      scrapeAccounts(scraping, undefined, undefined, abort.signal),
    ).rejects.toThrow("caller cancelled");
    expect(Worker).not.toHaveBeenCalled();
  });

  it("cooperatively cancels before the worker is ready and removes the caller listener", async () => {
    const abort = new AbortController();
    const run = scrapeAccounts(scraping, undefined, undefined, abort.signal);
    abort.abort(new Error("caller cancelled"));
    await expect(run).rejects.toThrow("caller cancelled");
    expect(api.cancel).toHaveBeenCalled();
    expect(api[releaseProxy].mock.invocationCallOrder[0]).toBeLessThan(
      worker.terminate.mock.invocationCallOrder[0],
    );
    expect(getEventListeners(abort.signal, "abort")).toEqual([]);
  });

  it("leaves process signals to the caller while a scrape is active", async () => {
    const run = scrapeAccounts(scraping);
    expect(processEvents.map((event) => process.listenerCount(event))).toEqual(
      processListeners,
    );
    expect(api.cancel).not.toHaveBeenCalled();
    await expect(run).resolves.toEqual({ results, domains: {} });
  });

  it("removes the caller's abort listener after successful cleanup", async () => {
    const abort = new AbortController();
    await scrapeAccounts(scraping, undefined, undefined, abort.signal);
    expect(getEventListeners(abort.signal, "abort")).toEqual([]);
    expect(abort.signal.aborted).toBe(false);
    const cancelCalls = api.cancel.mock.calls.length;
    abort.abort();
    expect(api.cancel).toHaveBeenCalledTimes(cancelCalls);
  });

  it("uses a separate allowlisted environment and default parent stdout/stderr routing", async () => {
    const saved = process.env;
    process.env = {
      ...saved,
      MONEYMAN_CONFIG: "private",
      MONEYMAN_CONFIG_PATH: "private.json",
      MONEYMAN_PUBLIC_LOG_FD: "3",
      TELEGRAM_TOKEN: "private",
      SECRET_PROVIDER_TOKEN: "private",
      BITWARDEN_ACCESS_TOKEN: "provider-token",
      MONEYMAN_CONFIG_SECRET_PROVIDER: "bitwarden",
      MONEYMAN_CONFIG_SECRET_ID: "secret-id",
      MONEYMAN_CONFIG_SECRET: "descriptor",
      NODE_OPTIONS: "--require dotenv/config",
      DOTENV_CONFIG_PATH: ".env",
      DEBUG: "private",
    };
    try {
      await expect(scrapeAccounts(scraping)).resolves.toEqual({
        results,
        domains: {},
      });
      const [filename, options] = jest.mocked(Worker).mock.calls[0];
      expect(String(filename)).toMatch(/scraper\/worker\.js$/);
      expect(options?.execArgv).toEqual([]);
      expect(options).not.toHaveProperty("stdout");
      expect(options).not.toHaveProperty("stderr");
      for (const key of [
        "MONEYMAN_CONFIG",
        "MONEYMAN_CONFIG_PATH",
        "MONEYMAN_PUBLIC_LOG_FD",
        "TELEGRAM_TOKEN",
        "SECRET_PROVIDER_TOKEN",
        "BITWARDEN_ACCESS_TOKEN",
        "MONEYMAN_CONFIG_SECRET_PROVIDER",
        "MONEYMAN_CONFIG_SECRET_ID",
        "MONEYMAN_CONFIG_SECRET",
        "NODE_OPTIONS",
        "DOTENV_CONFIG_PATH",
        "DEBUG",
      ]) {
        expect(options?.env).not.toHaveProperty(key);
      }
      const settings = api.scrape.mock.calls[0][0];
      expect(settings).toMatchObject({
        accounts: scraping.accounts,
        startDate: scraping.startDate,
        enableOtp: true,
      });
      expect(JSON.stringify(settings)).not.toMatch(
        /storage-secret|telegram-secret/,
      );
    } finally {
      process.env = saved;
    }
  });

  it("relays intended callbacks and domain metadata", async () => {
    const onStatus = jest.fn(async () => {});
    const onError = jest.fn(async () => {});
    api.scrape.mockImplementationOnce(async () => {
      await callbacks().status(["working"], 2);
      await callbacks().warning(new Error("close failed"), "browser.close");
      callbacks()[finalizer]();
      return { results, domains: { oneZero: { allowed: ["GET bank.test"] } } };
    });

    const result = await scrapeAccounts(scraping, onStatus, onError);
    expect(onStatus).toHaveBeenCalledWith(["working"], 2);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "close failed" }),
      "browser.close",
    );
    expect(result.domains).toEqual({
      oneZero: { allowed: ["GET bank.test"] },
    });
  });

  it("uses explicit fresh bank, scraper and firewall inputs for each worker", async () => {
    const fresh = {
      ...scraping,
      accounts: [{ ...scraping.accounts[0], password: "rotated-bank" }],
      executablePath: "fresh-browser",
      domainTracking: false,
      firewallSettings: ["oneZero DENY old.test"],
      blockByDefault: false,
      parallelScrapers: 2,
      includeRawTransaction: false,
    };
    await scrapeAccounts(scraping);
    await scrapeAccounts(fresh);
    expect(api.scrape.mock.calls[0][0]).toMatchObject(scraping);
    expect(api.scrape.mock.calls[1][0]).toMatchObject(fresh);
    expect(api.scrape.mock.calls[0][0].accounts[0].password).toBe(
      "bank-password",
    );
  });

  it("routes concurrent OTP callbacks without custom request IDs and propagates OTP failures", async () => {
    jest
      .mocked(requestOtpCode)
      .mockResolvedValueOnce("654321")
      .mockRejectedValueOnce(new Error("OTP unavailable"));
    api.scrape.mockImplementationOnce(async () => {
      const replies = await Promise.allSettled([
        callbacks().otp(0),
        callbacks().otp(0),
      ]);
      expect(replies).toEqual([
        { status: "fulfilled", value: "654321" },
        {
          status: "rejected",
          reason: expect.objectContaining({ message: "OTP unavailable" }),
        },
      ]);
      callbacks()[finalizer]();
      return { results, domains: {} };
    });
    await scrapeAccounts(scraping);
    expect(requestOtpCode).toHaveBeenCalledWith(
      "oneZero",
      "+97200000000",
      expect.any(AbortSignal),
    );
  });

  it.each([-1, 0.5, 5])(
    "rejects unauthorized OTP account index %s",
    async (index) => {
      api.scrape.mockImplementationOnce(async () => {
        await expect(callbacks().otp(index)).rejects.toThrow(
          "Invalid scraper worker OTP request",
        );
        callbacks()[finalizer]();
        return { results, domains: {} };
      });
      await scrapeAccounts(scraping);
      expect(requestOtpCode).not.toHaveBeenCalled();
    },
  );

  it.each(["error", "exit"])(
    "rejects pending RPCs promptly on worker %s and cleans up",
    async (event) => {
      api.scrape.mockImplementationOnce(() => new Promise(() => {}));
      const run = scrapeAccounts(scraping);
      events.emit(
        event,
        event === "error" ? new Error("worker import failed") : 1,
      );
      await expect(run).rejects.toThrow(
        event === "error" ? "worker import failed" : "exited unexpectedly",
      );
      expect(worker.terminate).toHaveBeenCalled();
      expect(api.cancel).not.toHaveBeenCalled();
      expect(events.listenerCount("message")).toBe(0);
      expect(events.listenerCount("exit")).toBe(0);
      expect(events.listenerCount("error")).toBe(0);
    },
  );

  it("cancels pending OTP and waits for cooperative cleanup before terminating on a signal", async () => {
    let otpSignal: AbortSignal | undefined;
    jest
      .mocked(requestOtpCode)
      .mockImplementation((_company, _phone, signal) => {
        otpSignal = signal;
        return new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal.reason)),
        );
      });

    api.scrape.mockImplementationOnce(async () => {
      try {
        await callbacks().otp(0);
        return { results, domains: {} };
      } finally {
        callbacks()[finalizer]();
      }
    });
    const abort = new AbortController();
    const run = scrapeAccounts(scraping, undefined, undefined, abort.signal);
    const cancelled = expect(run).rejects.toThrow("cancelled");
    abort.abort(new Error("caller cancelled"));
    await cancelled;
    expect(otpSignal?.aborted).toBe(true);
    expect(api.cancel).toHaveBeenCalled();
    expect(api.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      worker.terminate.mock.invocationCallOrder[0],
    );
    expect(getEventListeners(abort.signal, "abort")).toEqual([]);
  });

  it("keeps cancellation primary when the losing scrape RPC rejects during cleanup", async () => {
    const pending = Promise.withResolvers<WorkerResult>();
    api.scrape.mockImplementationOnce(async () => {
      try {
        return await pending.promise;
      } finally {
        callbacks()[finalizer]();
      }
    });
    const abort = new AbortController();
    const run = scrapeAccounts(scraping, undefined, undefined, abort.signal);
    const cancelled = expect(run).rejects.toThrow("Scraper worker cancelled");
    abort.abort(new Error("Scraper worker cancelled"));
    await tick();
    expect(worker.terminate).not.toHaveBeenCalled();
    pending.reject(new Error("late scrape RPC failure"));
    await cancelled;
    await tick();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("waits for cleanup and releases both proxies before terminating", async () => {
    const cleanup = Promise.withResolvers<void>();
    api.cancel.mockReturnValueOnce(cleanup.promise);
    const run = scrapeAccounts(scraping);
    await tick();
    await tick();
    expect(worker.terminate).not.toHaveBeenCalled();
    cleanup.resolve();
    await run;
    expect(api[releaseProxy]).toHaveBeenCalled();
    expect(api[releaseProxy].mock.invocationCallOrder[0]).toBeLessThan(
      worker.terminate.mock.invocationCallOrder[0],
    );
  });

  it("waits for callback release after cooperative cancellation has drained", async () => {
    api.scrape.mockResolvedValueOnce({ results, domains: {} });
    const run = scrapeAccounts(scraping);
    await tick();
    expect(api.cancel).toHaveBeenCalled();
    expect(api[releaseProxy]).not.toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();
    callbacks()[finalizer]();
    await run;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("propagates scraper errors and still cleans up", async () => {
    api.scrape.mockImplementationOnce(async () => {
      callbacks()[finalizer]();
      throw new Error("scraper failed");
    });

    await expect(scrapeAccounts(scraping)).rejects.toThrow("scraper failed");
    expect(api.cancel).toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("aborts pending parent OTP when the worker exits unexpectedly", async () => {
    let otpSignal: AbortSignal | undefined;
    jest
      .mocked(requestOtpCode)
      .mockImplementation((_company, _phone, signal) => {
        otpSignal = signal;
        return new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal.reason)),
        );
      });
    api.scrape.mockImplementationOnce(async () => {
      try {
        await callbacks().otp(0);
        return { results, domains: {} };
      } finally {
        callbacks()[finalizer]();
      }
    });
    const run = scrapeAccounts(scraping);
    events.emit("exit", 1);
    await expect(run).rejects.toThrow("exited unexpectedly");
    expect(otpSignal?.aborted).toBe(true);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("reports unexpected cleanup failure after successful results", async () => {
    api.cancel.mockRejectedValueOnce(new Error("worker cleanup failed"));
    await expect(scrapeAccounts(scraping)).rejects.toThrow(
      "worker cleanup failed",
    );
    expect(worker.terminate).toHaveBeenCalled();
    expect(events.listenerCount("exit")).toBe(0);
  });

  it("preserves primary and cleanup failures, including notification diagnostics", async () => {
    const primary = new Error("scraper failed");
    const cleanup = new Error("worker cleanup failed");
    api.scrape.mockImplementationOnce(async () => {
      callbacks()[finalizer]();
      throw primary;
    });
    api.cancel.mockRejectedValueOnce(cleanup);
    const failure = await scrapeAccounts(scraping).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SuppressedError);
    expect(failure).toMatchObject({ error: cleanup, suppressed: primary });
    expect(formatUnknownError(failure)).toBe(
      "scraper failed; cleanup failed: worker cleanup failed",
    );
    expect(api[releaseProxy]).toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("still closes endpoints and terminates if proxy release throws", async () => {
    api[releaseProxy].mockImplementationOnce(() => {
      throw new Error("proxy release failed");
    });
    await expect(scrapeAccounts(scraping)).rejects.toThrow(
      "proxy release failed",
    );
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("retains failures from multiple resource disposers and removes listeners", async () => {
    const cancelError = new Error("cooperative cleanup failed");
    const terminateError = new Error("termination failed");
    api.cancel.mockRejectedValueOnce(cancelError);
    worker.terminate.mockRejectedValueOnce(terminateError);
    const failure = await scrapeAccounts(scraping).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SuppressedError);
    expect(failure).toMatchObject({
      error: terminateError,
      suppressed: cancelError,
    });
    expect(formatUnknownError(failure)).toBe(
      "cooperative cleanup failed; cleanup failed: termination failed",
    );
    expect(api[releaseProxy]).toHaveBeenCalled();
  });

  it("supports repeat runs without retained signal listeners or workers", async () => {
    const before = process.listenerCount("SIGTERM");
    for (let i = 0; i < 2; i++) await scrapeAccounts(scraping);
    expect(Worker).toHaveBeenCalledTimes(2);
    expect(worker.terminate).toHaveBeenCalledTimes(2);
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("returns independent metadata on repeated runs without a shared cache", async () => {
    api.scrape.mockImplementationOnce(async () => {
      callbacks()[finalizer]();
      return { results, domains: { oneZero: { allowed: ["GET first.test"] } } };
    });
    const first = await scrapeAccounts(scraping);
    const second = await scrapeAccounts(scraping);
    expect(first.domains).toEqual({ oneZero: { allowed: ["GET first.test"] } });
    expect(second.domains).toEqual({});
  });
});
