/// <reference lib="es2024.promise" />
import { locks, MessageChannel } from "node:worker_threads";
import { getEventListeners } from "node:events";
import type { Remote, ProxyMarked } from "comlink";
import { mock } from "jest-mock-extended";
import {
  WorkerConfigSchema,
  type ScraperWorkerApi,
  type WorkerCallbacks,
  type WorkerConfig,
} from "./protocol.js";
import type { AccountScrapeResult } from "../types.js";

jest.mock("node:worker_threads", () => ({
  ...jest.requireActual("node:worker_threads"),
  workerData: new (jest.requireActual("node:events").EventEmitter)(),
}));
jest.mock("comlink", () => ({
  ...jest.requireActual("comlink"),
  expose: jest.fn(),
}));
jest.mock("./index.js", () => ({ scrapeAccounts: jest.fn() }));
jest.mock("debug", () => ({ enable: jest.fn() }));
jest.mock("../security/domains.js", () => ({
  createDomainTracker: jest.fn(() => ({
    initDomainTracking: jest.fn(async () => {}),
    getUsedDomains: jest.fn(async () => ({})),
    dispose: jest.fn(),
  })),
}));

const settings: WorkerConfig = {
  accounts: [],
  startDate: new Date("2026-01-01T00:00:00Z"),
  futureMonthsToScrape: 1,
  parallelScrapers: 1,
  additionalTransactionInformation: false,
  includeRawTransaction: true,
  domainTracking: false,
  firewallSettings: [],
  blockByDefault: false,
  enableOtp: false,
  debugFilter: "",
};
const otpSettings = WorkerConfigSchema.parse({
  ...settings,
  enableOtp: true,
  accounts: [
    {
      companyId: "oneZero",
      email: "test@example.com",
      password: "password",
      phoneNumber: "+97200000000",
    },
  ],
});
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("worker session locks", () => {
  let session: ScraperWorkerApi;
  let scrapeAccounts: jest.MockedFunction<
    typeof import("./index.js").scrapeAccounts
  >;
  let releaseProxy: typeof import("comlink").releaseProxy;
  let createDomainTracker: jest.MockedFunction<
    typeof import("../security/domains.js").createDomainTracker
  >;
  let callbacks: ReturnType<typeof mock<Remote<WorkerCallbacks & ProxyMarked>>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    const comlink = await import("comlink");
    releaseProxy = comlink.releaseProxy;
    scrapeAccounts = jest.mocked((await import("./index.js")).scrapeAccounts);
    createDomainTracker = jest.mocked(
      (await import("../security/domains.js")).createDomainTracker,
    );
    callbacks = mock<Remote<WorkerCallbacks & ProxyMarked>>({
      [releaseProxy]: jest.fn(),
    });
    jest.mocked(scrapeAccounts).mockResolvedValue([]);
    await import("./worker.js");
    session = jest
      .mocked(comlink.expose)
      .mock.calls.at(-1)![0] as ScraperWorkerApi;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    const snapshot = await locks.query();
    expect(
      [...snapshot.held, ...snapshot.pending].filter((lock) =>
        lock.name.startsWith("moneyman.scraper."),
      ),
    ).toEqual([]);
  });

  it("snapshots and disposes its own tracker before releasing callbacks", async () => {
    const result = await session.scrape(settings, callbacks);
    const tracker = createDomainTracker.mock.results[0].value;
    expect(scrapeAccounts).toHaveBeenCalledWith(
      expect.any(Object),
      tracker.initDomainTracking,
      expect.any(Function),
      expect.any(Function),
      expect.any(Object),
    );
    expect(result.domains).toEqual({});
    expect(tracker.dispose).toHaveBeenCalledTimes(1);
    expect(
      jest.mocked(tracker.getUsedDomains).mock.invocationCallOrder[0],
    ).toBeLessThan(jest.mocked(tracker.dispose).mock.invocationCallOrder[0]);
    expect(
      jest.mocked(tracker.dispose).mock.invocationCallOrder[0],
    ).toBeLessThan(callbacks[releaseProxy].mock.invocationCallOrder[0]);
  });

  it("disposes the tracker when browser startup fails", async () => {
    scrapeAccounts.mockRejectedValueOnce(new Error("browser startup failed"));
    await expect(session.scrape(settings, callbacks)).rejects.toThrow(
      "browser startup failed",
    );
    expect(
      createDomainTracker.mock.results[0].value.dispose,
    ).toHaveBeenCalledTimes(1);
    expect(callbacks[releaseProxy]).toHaveBeenCalledTimes(1);
  });

  it.each(["scrape", "snapshot"])(
    "preserves the %s failure when tracker disposal also fails",
    async (operation) => {
      const primary = new Error(`${operation} failed`);
      const cleanup = new Error("tracker cleanup failed");
      const tracker = mock<ReturnType<typeof createDomainTracker>>();
      tracker.getUsedDomains.mockResolvedValue({});
      tracker.dispose.mockImplementation(() => {
        throw cleanup;
      });
      createDomainTracker.mockReturnValueOnce(tracker);
      if (operation === "scrape") scrapeAccounts.mockRejectedValueOnce(primary);
      else tracker.getUsedDomains.mockRejectedValueOnce(primary);

      const failure = await session
        .scrape(settings, callbacks)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(SuppressedError);
      expect(failure).toMatchObject({ error: cleanup, suppressed: primary });
      expect(callbacks[releaseProxy]).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    "retains both disposal failures with an operation failure (%s)",
    async (failOperation) => {
      const primary = new Error("scrape failed");
      const trackerError = new Error("tracker cleanup failed");
      const releaseError = new Error("callback release failed");
      const tracker = mock<ReturnType<typeof createDomainTracker>>();
      tracker.getUsedDomains.mockResolvedValue({});
      tracker.dispose.mockImplementation(() => {
        throw trackerError;
      });
      callbacks[releaseProxy].mockImplementation(() => {
        throw releaseError;
      });
      createDomainTracker.mockReturnValueOnce(tracker);
      if (failOperation) scrapeAccounts.mockRejectedValueOnce(primary);

      const failure = await session
        .scrape(settings, callbacks)
        .catch((error: unknown) => error);
      const disposal = { error: releaseError, suppressed: trackerError };

      expect(failure).toBeInstanceOf(SuppressedError);
      expect(failure).toMatchObject(
        failOperation ? { error: disposal, suppressed: primary } : disposal,
      );
      expect(tracker.dispose).toHaveBeenCalledTimes(1);
      expect(callbacks[releaseProxy]).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    "preserves cleanup diagnostics across real Comlink with an operation failure (%s)",
    async (failOperation) => {
      const comlink = jest.requireActual<typeof import("comlink")>("comlink");
      const tracker = mock<ReturnType<typeof createDomainTracker>>();
      tracker.getUsedDomains.mockResolvedValue({});
      tracker.dispose.mockImplementation(() => {
        throw new Error("tracker cleanup failed");
      });
      callbacks[releaseProxy].mockImplementation(() => {
        throw new Error("callback release failed");
      });
      createDomainTracker.mockReturnValueOnce(tracker);
      if (failOperation)
        scrapeAccounts.mockRejectedValueOnce(new Error("scrape failed"));
      const { port1, port2 } = new MessageChannel();
      const endpoint = { scrape: () => session.scrape(settings, callbacks) };
      comlink.expose(endpoint, port2);
      const api = comlink.wrap<typeof endpoint>(port1);
      try {
        await expect(api.scrape()).rejects.toThrow(
          `${failOperation ? "scrape failed; cleanup failed: " : ""}tracker cleanup failed; cleanup failed: callback release failed`,
        );
      } finally {
        api[comlink.releaseProxy]();
        port1.close();
        port2.close();
      }
    },
  );

  it("rejects overlapping runs instead of queuing them", async () => {
    const started = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<AccountScrapeResult[]>();
    jest.mocked(scrapeAccounts).mockImplementationOnce(async () => {
      started.resolve();
      return finished.promise;
    });
    const run = session.scrape(settings, callbacks);
    await started.promise;
    const overlapping = mock<Remote<WorkerCallbacks & ProxyMarked>>({
      [releaseProxy]: jest.fn(),
    });
    await expect(session.scrape(settings, overlapping)).rejects.toThrow(
      "already has a run",
    );
    expect(overlapping[releaseProxy]).toHaveBeenCalledTimes(1);
    expect(scrapeAccounts).toHaveBeenCalledTimes(1);
    finished.resolve([]);
    await run;
  });

  it("cancels before scraping without launching a browser", async () => {
    await session.cancel();
    await expect(session.scrape(settings, callbacks)).rejects.toThrow(
      "cancelled",
    );
    expect(scrapeAccounts).not.toHaveBeenCalled();
    expect(createDomainTracker).not.toHaveBeenCalled();
    expect(callbacks[releaseProxy]).toHaveBeenCalledTimes(1);
  });

  it("preserves cancellation while its drain lock is still pending", async () => {
    const cancellation = session.cancel();
    await expect(session.scrape(settings, callbacks)).rejects.toThrow(
      "cancelled",
    );
    await cancellation;
    expect(scrapeAccounts).not.toHaveBeenCalled();
    expect(callbacks[releaseProxy]).toHaveBeenCalledTimes(1);
  });

  it("waits for startup/browser cleanup before cancellation finishes", async () => {
    const started = Promise.withResolvers<AbortSignal>();
    const cleaned = Promise.withResolvers<AccountScrapeResult[]>();
    jest
      .mocked(scrapeAccounts)
      .mockImplementationOnce(
        async (_settings, _tracking, _status, _warning, runtime) => {
          started.resolve(runtime!.signal!);
          return cleaned.promise;
        },
      );
    const run = session.scrape(settings, callbacks);
    const rejected = expect(run).rejects.toThrow("cancelled");
    const signal = await started.promise;
    const cancelled = jest.fn();
    const cancel = session.cancel().then(cancelled);
    await tick();
    expect(signal.aborted).toBe(true);
    expect(cancelled).not.toHaveBeenCalled();
    expect(callbacks[releaseProxy]).not.toHaveBeenCalled();
    const tracker = createDomainTracker.mock.results[0].value;
    expect(tracker.dispose).not.toHaveBeenCalled();
    cleaned.resolve([]);
    await rejected;
    await cancel;
    expect(callbacks[releaseProxy]).toHaveBeenCalledTimes(1);
    expect(tracker.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(["reply", "cancel"])(
    "cleans up the OTP wait on %s even when an abort handler stops propagation",
    async (completion) => {
      const any = AbortSignal.any;
      const combined = jest
        .spyOn(AbortSignal, "any")
        .mockImplementation((signals) => {
          const signal = any(signals);
          signal.addEventListener(
            "abort",
            (event) => event.stopImmediatePropagation(),
            { once: true },
          );
          return signal;
        });
      const started = Promise.withResolvers<void>();
      const reply = Promise.withResolvers<string>();
      callbacks.otp.mockImplementation(() => {
        started.resolve();
        return reply.promise;
      });
      scrapeAccounts.mockImplementationOnce(
        async (_settings, _tracking, _status, _warning, runtime) => {
          expect(
            await runtime!.requestOtpCode!("oneZero", "+97200000000"),
          ).toBe("123456");
          return [];
        },
      );
      const run = session.scrape(otpSettings, callbacks);
      const expected =
        completion === "cancel"
          ? expect(run).rejects.toThrow("cancelled")
          : expect(run).resolves.toEqual({ results: [], domains: {} });
      await started.promise;
      const signal = combined.mock.results[0].value as AbortSignal;
      expect(getEventListeners(signal, "abort")).toHaveLength(2);
      const cancelled = completion === "cancel" ? session.cancel() : undefined;
      if (completion === "reply") reply.resolve("123456");
      await expected;
      await cancelled;
      expect(getEventListeners(signal, "abort")).toEqual([]);
      expect(callbacks[releaseProxy]).toHaveBeenCalledTimes(1);
    },
  );

  it("handles cancellation during OTP dispatch before subscribing to the abort", async () => {
    const cancelled = Promise.withResolvers<void>();
    callbacks.otp.mockImplementation(() => {
      void session.cancel().then(cancelled.resolve, cancelled.reject);
      return new Promise(() => {});
    });
    scrapeAccounts.mockImplementationOnce(
      async (_settings, _tracking, _status, _warning, runtime) => {
        await runtime!.requestOtpCode!("oneZero", "+97200000000");
        return [];
      },
    );
    await expect(session.scrape(otpSettings, callbacks)).rejects.toThrow(
      "cancelled",
    );
    await cancelled.promise;
    expect(callbacks[releaseProxy]).toHaveBeenCalledTimes(1);
  });

  it("propagates OTP callback failures and releases session resources", async () => {
    const failure = new Error("OTP unavailable");
    callbacks.otp.mockRejectedValueOnce(failure);
    scrapeAccounts.mockImplementationOnce(
      async (_settings, _tracking, _status, _warning, runtime) => {
        await runtime!.requestOtpCode!("oneZero", "+97200000000");
        return [];
      },
    );
    await expect(session.scrape(otpSettings, callbacks)).rejects.toBe(failure);
    expect(callbacks.otp).toHaveBeenCalledWith(0);
    expect(callbacks[releaseProxy]).toHaveBeenCalledTimes(1);
    expect(
      createDomainTracker.mock.results[0].value.dispose,
    ).toHaveBeenCalledTimes(1);
  });

  it("routes a shared-phone OTP request past a token-bearing account", async () => {
    callbacks.otp.mockResolvedValueOnce("123456");
    scrapeAccounts.mockImplementationOnce(
      async (_settings, _tracking, _status, _warning, runtime) => {
        expect(await runtime!.requestOtpCode!("oneZero", "+97200000000")).toBe(
          "123456",
        );
        return [];
      },
    );
    const sharedPhoneSettings = WorkerConfigSchema.parse({
      ...otpSettings,
      accounts: [
        { ...otpSettings.accounts[0], otpLongTermToken: "existing-token" },
        otpSettings.accounts[0],
      ],
    });

    await expect(
      session.scrape(sharedPhoneSettings, callbacks),
    ).resolves.toEqual({ results: [], domains: {} });
    expect(callbacks.otp).toHaveBeenCalledWith(1);
    expect(callbacks[releaseProxy]).toHaveBeenCalledTimes(1);
  });

  it("aborts pending OTP when an unawaited progress callback fails", async () => {
    const failure = new Error("progress callback failed");
    callbacks.status.mockRejectedValueOnce(failure);
    callbacks.otp.mockImplementation(() => new Promise(() => {}));
    scrapeAccounts.mockImplementationOnce(
      async (_settings, _tracking, status, _warning, runtime) => {
        void status!(["working"]);
        await runtime!.requestOtpCode!("oneZero", "+97200000000");
        return [];
      },
    );
    await expect(session.scrape(otpSettings, callbacks)).rejects.toBe(failure);
    expect(callbacks.otp).toHaveBeenCalledWith(0);
    expect(callbacks[releaseProxy]).toHaveBeenCalledTimes(1);
    expect(
      createDomainTracker.mock.results[0].value.dispose,
    ).toHaveBeenCalledTimes(1);
  });

  it("serializes unawaited progress and drains it before releasing callbacks", async () => {
    const started = Promise.withResolvers<void>();
    const next = Promise.withResolvers<void>();
    const order: string[] = [];
    jest
      .mocked(scrapeAccounts)
      .mockImplementationOnce(async (_settings, _tracking, status) => {
        const rows = ["first"];
        void status!(rows);
        rows[0] = "second";
        void status!(rows);
        return [];
      });
    callbacks.status.mockImplementation(async ([row]) => {
      if (row === "first") {
        started.resolve();
        await next.promise;
      }
      order.push(row);
    });
    callbacks[releaseProxy].mockImplementation(() => {
      order.push("released");
    });
    const run = session.scrape(settings, callbacks);
    await started.promise;
    expect(callbacks.status).toHaveBeenCalledTimes(1);
    expect(callbacks[releaseProxy]).not.toHaveBeenCalled();
    expect(
      createDomainTracker.mock.results[0].value.dispose,
    ).not.toHaveBeenCalled();
    next.resolve();
    await run;
    expect(order).toEqual(["first", "second", "released"]);
  });

  it.each(["first", "last"])(
    "propagates %s progress failure during drain without dropping queued events",
    async (failure) => {
      const entered = Promise.withResolvers<void>();
      const next = Promise.withResolvers<void>();
      jest
        .mocked(scrapeAccounts)
        .mockImplementationOnce(async (_settings, _tracking, status) => {
          void status!(["first"]);
          void status!(["last"]);
          return [];
        });
      callbacks.status.mockImplementation(async ([row]) => {
        if (row === failure) {
          entered.resolve();
          await next.promise;
          throw new Error(`${failure} progress failed`);
        }
      });
      const run = session.scrape(settings, callbacks);
      const rejected = expect(run).rejects.toThrow(
        `${failure} progress failed`,
      );
      await entered.promise;
      await tick();
      expect(callbacks[releaseProxy]).not.toHaveBeenCalled();
      next.resolve();
      await rejected;
      expect(callbacks.status.mock.calls.map(([rows]) => rows)).toEqual([
        ["first"],
        ["last"],
      ]);
      expect(callbacks[releaseProxy]).toHaveBeenCalledTimes(1);
      expect(
        createDomainTracker.mock.results[0].value.dispose,
      ).toHaveBeenCalledTimes(1);
    },
  );
});
