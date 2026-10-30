import type { AccountScrapeResult, RunnerHooks, RunTrigger } from "./types.js";
import type { ServerRunner } from "./server.js";
import { createRunReport } from "./bot/runReport.js";
import { mock } from "jest-mock-extended";
import { CompanyTypes } from "israeli-bank-scrapers";

jest.mock("./config.js", () => ({
  config: jest
    .requireActual<typeof import("./config.schema.js")>("./config.schema.js")
    .MoneymanConfigSchema.parse({}),
  getScraperConfig: jest.fn((snapshot) => ({
    accounts: snapshot.accounts,
    ...snapshot.options.scraping,
    ...snapshot.options.security,
  })),
  sendConfigToTelegramIfRequested: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./scraper/client.js", () => ({ scrapeAccounts: jest.fn() }));
jest.mock("./bot/index.js", () => ({
  runWithStorage: jest.fn(
    jest.requireActual<typeof import("./bot/index.js")>("./bot/index.js")
      .runWithStorage,
  ),
}));
jest.mock("./bot/storage/index.js", () => ({
  createStorages: jest.fn(() => [{}]),
  saveResults: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./configRefresh.js", () => ({
  hasConfigSecretProvider: jest.fn(() => false),
  loadRunConfig: jest.fn(async () => (await import("./config.js")).config),
  SECRET_REFRESH_FAILURE:
    "Secret refresh failed. No scrape started. Check the private logs and provider access, then retry.",
}));
jest.mock("./bot/notifier.js", () => ({
  sendError: jest.fn().mockResolvedValue(undefined),
  sendPhotos: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./server.js", () => ({ startServer: jest.fn() }));
jest.mock("./utils/secure-log.js", () => ({
  enableDebugLoggingIfNeeded: jest.fn(),
  sendLogFile: jest.fn(),
  readReportLogs: jest.fn(),
}));
jest.mock("./runnerMetadata.js", () => ({
  getExternalIp: jest.fn().mockResolvedValue({}),
  logRunMetadata: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./security/domains.js", () => ({
  createDomainTracker: jest.fn(() => ({
    getUsedDomains: jest.fn(async () => ({
      node: { main: ["GET parent.test"] },
    })),
    dispose: jest.fn(),
  })),
}));
jest.mock("./utils/failureScreenshot.js", () => ({
  sendFailureScreenShots: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./utils/logger.js", () => ({
  createLogger: () => jest.fn(),
  logToPublicLog: jest.fn(),
}));

const accountResult = (
  companyId: CompanyTypes,
  success: boolean,
): AccountScrapeResult => ({ companyId, result: { success, accounts: [] } });

function hooks(): RunnerHooks {
  const mockedHooks = mock<RunnerHooks>();
  mockedHooks.onBeforeStart.mockResolvedValue(undefined);
  mockedHooks.onStatusChanged.mockResolvedValue(undefined);
  mockedHooks.onResultsReady.mockResolvedValue(undefined);
  mockedHooks.onError.mockResolvedValue(undefined);
  mockedHooks.failureScreenshotsHandler.mockResolvedValue(undefined);
  return mockedHooks;
}

async function loadEntrypoint(
  longRunning: boolean,
  providerConfigured = false,
  configureScrape?: (
    scrape: jest.MockedFunction<
      typeof import("./scraper/client.js").scrapeAccounts
    >,
  ) => void,
) {
  jest.resetModules();
  process.env.MONEYMAN_LONG_RUNNING = longRunning ? "true" : "";
  let started!: () => void;
  const startup = new Promise<void>((resolve) => (started = resolve));
  const exit = jest
    .spyOn(process, "exit")
    .mockImplementation((() => started()) as never);

  const { scrapeAccounts } = await import("./scraper/client.js");
  const { runWithStorage } = await import("./bot/index.js");
  const { sendLogFile } = await import("./utils/secure-log.js");
  const { startServer } = await import("./server.js");
  const { runContextStore } = await import("./utils/asyncContext.js");
  const { hasConfigSecretProvider } = await import("./configRefresh.js");
  jest.mocked(hasConfigSecretProvider).mockReturnValue(providerConfigured);
  const scrapeAccountsMock = jest.mocked(scrapeAccounts);
  const runWithStorageMock = jest.mocked(runWithStorage);
  const startServerMock = jest.mocked(startServer);
  scrapeAccountsMock.mockResolvedValue({ results: [], domains: {} });
  configureScrape?.(scrapeAccountsMock);
  startServerMock.mockImplementation(async () => started());

  await import("./index.js");
  await startup;

  return {
    exit,
    scrapeAccountsMock,
    runWithStorageMock,
    sendLogFileMock: jest.mocked(sendLogFile),
    startServerMock,
    runContextStore,
  };
}

describe("index", () => {
  const originalEnv = process.env;
  let originalExceptionListeners: ReturnType<typeof process.listeners>;
  let originalExitListeners: ReturnType<typeof process.listeners>;

  beforeEach(() => {
    originalExceptionListeners = process.listeners("uncaughtException");
    originalExitListeners = process.listeners("exit");
  });

  afterEach(() => {
    for (const listener of process.listeners("uncaughtException")) {
      if (!originalExceptionListeners.includes(listener)) {
        process.removeListener("uncaughtException", listener);
      }
    }
    for (const listener of process.listeners("exit")) {
      if (!originalExitListeners.includes(listener))
        process.removeListener("exit", listener);
    }
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("runs once and exits by default", async () => {
    const listeners = ["SIGINT", "SIGTERM"].map((signal) =>
      process.listenerCount(signal),
    );
    const { exit, runWithStorageMock, startServerMock, sendLogFileMock } =
      await loadEntrypoint(false, true);

    expect(runWithStorageMock).toHaveBeenCalledTimes(1);
    expect(startServerMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
    expect(sendLogFileMock).toHaveBeenCalledWith(true, [{}]);
    const { loadRunConfig } = await import("./configRefresh.js");
    expect(loadRunConfig).not.toHaveBeenCalled();
    expect(
      ["SIGINT", "SIGTERM"].map((signal) => process.listenerCount(signal)),
    ).toEqual(listeners);
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "cancels the one-shot scrape on %s and removes its signal listeners",
    async (signalName) => {
      const listeners = ["SIGINT", "SIGTERM"].map((signal) =>
        process.listenerCount(signal),
      );
      const { exit, scrapeAccountsMock } = await loadEntrypoint(
        false,
        false,
        (scrape) =>
          scrape.mockImplementationOnce(
            async (_settings, _status, _error, signal) => {
              expect(signal?.aborted).toBe(false);
              process.emit(signalName);
              expect(signal?.aborted).toBe(true);
              throw signal!.reason;
            },
          ),
      );
      expect(scrapeAccountsMock).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
      expect(
        ["SIGINT", "SIGTERM"].map((signal) => process.listenerCount(signal)),
      ).toEqual(listeners);
    },
  );

  it("disposes the per-run parent tracker after scraping", async () => {
    await loadEntrypoint(false);
    const { createDomainTracker } = await import("./security/domains.js");
    const tracker = jest.mocked(createDomainTracker).mock.results[0].value;
    expect(tracker.dispose).toHaveBeenCalledTimes(1);
  });

  describe("long running", () => {
    let mocks: Awaited<ReturnType<typeof loadEntrypoint>>;
    let runner: Required<ServerRunner>;

    beforeEach(async () => {
      process.env = { ...originalEnv };
      mocks = await loadEntrypoint(true, true);
      const configured = mocks.startServerMock.mock.calls[0][0];
      if (!configured.refreshSecrets)
        throw new Error("Missing configured secret refresh capability");
      runner = { ...configured, refreshSecrets: configured.refreshSecrets };
    });

    /** Runs to completion, the way the one-shot entrypoint does. */
    const runOnce = async (trigger: RunTrigger) =>
      (await runner.startRun(trigger)).finished;

    it("hands the runner to the server without running", () => {
      expect(mocks.runWithStorageMock).not.toHaveBeenCalled();
      expect(mocks.exit).not.toHaveBeenCalled();
    });

    it.each(["manual", "scheduled"] as const)(
      "refreshes before every %s scrape and passes the same fresh snapshot to storage and scraping",
      async (trigger) => {
        const { loadRunConfig } = await import("./configRefresh.js");
        const { createStorages } = await import("./bot/storage/index.js");
        const { MoneymanConfigSchema } = await import("./config.schema.js");
        const fresh = MoneymanConfigSchema.parse({
          accounts: [{ companyId: "hapoalim", password: "fresh-bank" }],
          storage: {
            webPost: {
              url: "https://fresh.test",
              authorizationToken: "fresh-storage",
            },
          },
          options: {
            scraping: {
              daysBack: 28,
              maxParallelScrapers: 3,
              includeRawTransaction: true,
            },
            security: { blockByDefault: true },
          },
        });
        const newer = structuredClone(fresh);
        newer.accounts[0].password = "newer-bank";
        newer.storage.webPost!.authorizationToken = "newer-storage";
        jest
          .mocked(loadRunConfig)
          .mockResolvedValueOnce(fresh)
          .mockResolvedValueOnce(newer);

        await runOnce(trigger);
        await runOnce(trigger);

        expect(loadRunConfig).toHaveBeenCalledTimes(2);
        expect(createStorages).toHaveBeenNthCalledWith(1, fresh);
        expect(createStorages).toHaveBeenNthCalledWith(2, newer);
        expect(mocks.scrapeAccountsMock.mock.calls[0][0]).toMatchObject({
          accounts: fresh.accounts,
          daysBack: 28,
          maxParallelScrapers: 3,
          includeRawTransaction: true,
          blockByDefault: true,
        });
        expect(
          mocks.scrapeAccountsMock.mock.calls[1][0].accounts[0].password,
        ).toBe("newer-bank");
        expect(
          jest.mocked(loadRunConfig).mock.invocationCallOrder[0],
        ).toBeLessThan(jest.mocked(createStorages).mock.invocationCallOrder[0]);
      },
    );

    it("blocks a failed automatic refresh before creating clients or scraping, reports safely and permits retry", async () => {
      const { loadRunConfig, SECRET_REFRESH_FAILURE } =
        await import("./configRefresh.js");
      const { createStorages } = await import("./bot/storage/index.js");
      const { sendError } = await import("./bot/notifier.js");
      const { logToPublicLog } = await import("./utils/logger.js");
      jest
        .mocked(loadRunConfig)
        .mockRejectedValueOnce(new Error("provider-sensitive-token"));

      expect(await runOnce("scheduled")).toMatchObject({ failed: true });
      expect(createStorages).not.toHaveBeenCalled();
      expect(mocks.scrapeAccountsMock).not.toHaveBeenCalled();
      expect(sendError).toHaveBeenCalledWith(
        new Error(SECRET_REFRESH_FAILURE),
        "Secrets refresh",
      );
      expect(logToPublicLog).toHaveBeenCalledWith(SECRET_REFRESH_FAILURE);
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(false, []);
      expect(await runner.isRunning()).toBe(false);
      expect(await runOnce("manual")).toMatchObject({ failed: false });
    });

    it("does not expose refresh when no provider is configured", async () => {
      const unconfigured = await loadEntrypoint(true, false);
      const { loadRunConfig } = await import("./configRefresh.js");
      expect(
        unconfigured.startServerMock.mock.calls[0][0].refreshSecrets,
      ).toBeUndefined();
      expect(loadRunConfig).not.toHaveBeenCalled();
      expect(unconfigured.scrapeAccountsMock).not.toHaveBeenCalled();
      expect(unconfigured.runWithStorageMock).not.toHaveBeenCalled();
    });

    it("actually fetches and validates for a refresh command without scraping, and still refreshes the next scrape", async () => {
      const { loadRunConfig, hasConfigSecretProvider } =
        await import("./configRefresh.js");
      jest.mocked(hasConfigSecretProvider).mockReturnValue(true);
      expect(await runner.refreshSecrets()).toBe("refreshed");
      expect(loadRunConfig).toHaveBeenCalledTimes(1);
      expect(mocks.scrapeAccountsMock).not.toHaveBeenCalled();
      expect(mocks.runWithStorageMock).not.toHaveBeenCalled();
      expect(runner.getLastRun()).toBeUndefined();
      await runOnce("manual");
      expect(loadRunConfig).toHaveBeenCalledTimes(2);
    });

    it("refreshes during scraping without altering the run's snapshot, and rejects duplicate scrapes through log delivery", async () => {
      const { loadRunConfig, hasConfigSecretProvider } =
        await import("./configRefresh.js");
      const { config } = await import("./config.js");
      const { createStorages } = await import("./bot/storage/index.js");
      const fresh = structuredClone(config);
      fresh.accounts = [{ companyId: "hapoalim", password: "retained-bank" }];
      const newer = structuredClone(fresh);
      newer.accounts[0].password = "refreshed-bank";
      jest
        .mocked(loadRunConfig)
        .mockResolvedValueOnce(fresh)
        .mockResolvedValue(newer);
      jest.mocked(hasConfigSecretProvider).mockReturnValue(true);
      const scrape =
        Promise.withResolvers<
          Awaited<
            ReturnType<typeof import("./scraper/client.js").scrapeAccounts>
          >
        >();
      mocks.scrapeAccountsMock.mockReturnValue(scrape.promise);
      const log = Promise.withResolvers<void>();
      mocks.sendLogFileMock.mockReturnValue(log.promise);

      const handle = await runner.startRun("manual");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await runner.refreshSecrets()).toBe("refreshed");
      expect((await runner.startRun("scheduled")).started).toBe(false);
      expect(loadRunConfig).toHaveBeenCalledTimes(2);
      expect(jest.mocked(createStorages).mock.calls[0][0]).toBe(fresh);
      expect(mocks.scrapeAccountsMock.mock.calls[0][0].accounts).toBe(
        fresh.accounts,
      );
      expect(fresh.accounts[0].password).toBe("retained-bank");
      scrape.resolve({ results: [], domains: {} });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(await runner.isRunning()).toBe(true);
      expect((await runner.startRun("scheduled")).started).toBe(false);
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(
        false,
        jest.mocked(createStorages).mock.results[0].value,
      );
      log.resolve();
      await handle.finished;
      expect(await runner.isRunning()).toBe(false);
    });

    it("allows scrapes and other refreshes while a manual refresh is pending", async () => {
      const { loadRunConfig, hasConfigSecretProvider } =
        await import("./configRefresh.js");
      const { config } = await import("./config.js");
      jest.mocked(hasConfigSecretProvider).mockReturnValue(true);
      const loading = Promise.withResolvers<typeof config>();
      jest.mocked(loadRunConfig).mockReturnValueOnce(loading.promise);
      const scrape =
        Promise.withResolvers<
          Awaited<
            ReturnType<typeof import("./scraper/client.js").scrapeAccounts>
          >
        >();
      mocks.scrapeAccountsMock.mockReturnValue(scrape.promise);
      const refresh = runner.refreshSecrets();
      expect(await runner.isRunning()).toBe(false);
      const secondRefresh = runner.refreshSecrets();
      const handle = await runner.startRun("manual");
      expect(handle.started).toBe(true);
      expect((await runner.startRun("scheduled")).started).toBe(false);
      expect(await secondRefresh).toBe("refreshed");
      expect(loadRunConfig).toHaveBeenCalledTimes(3);
      scrape.resolve({ results: [], domains: {} });
      await handle.finished;
      expect(await runner.isRunning()).toBe(false);
      loading.resolve(config);
      expect(await refresh).toBe("refreshed");
    });

    it("reports a manual refresh failure without scraping and releases ownership for retry", async () => {
      const { loadRunConfig, hasConfigSecretProvider } =
        await import("./configRefresh.js");
      jest.mocked(hasConfigSecretProvider).mockReturnValue(true);
      jest
        .mocked(loadRunConfig)
        .mockRejectedValueOnce(new Error("provider-sensitive"));
      expect(await runner.refreshSecrets()).toBe("failed");
      expect(mocks.scrapeAccountsMock).not.toHaveBeenCalled();
      expect(mocks.runWithStorageMock).not.toHaveBeenCalled();
      expect(await runner.refreshSecrets()).toBe("refreshed");
    });

    it("leaves signal ownership with the server during an active run", async () => {
      const listeners = ["SIGINT", "SIGTERM"].map((signal) =>
        process.listenerCount(signal),
      );
      const pending = Promise.withResolvers<{
        results: AccountScrapeResult[];
        domains: {};
      }>();
      const started = Promise.withResolvers<void>();
      mocks.scrapeAccountsMock.mockImplementationOnce(
        (_settings, _status, _error, signal) => {
          expect(signal).toBeUndefined();
          started.resolve();
          return pending.promise;
        },
      );
      const handle = await runner.startRun("manual");
      await started.promise;
      expect(
        ["SIGINT", "SIGTERM"].map((signal) => process.listenerCount(signal)),
      ).toEqual(listeners);
      pending.resolve({
        results: [accountResult(CompanyTypes.hapoalim, true)],
        domains: {},
      });
      await expect(handle.finished).resolves.toMatchObject({ failed: false });
      const { saveResults } = await import("./bot/storage/index.js");
      expect(saveResults).toHaveBeenCalled();
    });

    it("reports a run where everything worked as successful", async () => {
      const domains = { hapoalim: { allowed: ["GET bank.test"] } };
      mocks.scrapeAccountsMock.mockResolvedValue({
        results: [accountResult(CompanyTypes.hapoalim, true)],
        domains,
      });

      const result = await runOnce("manual");

      const { sendError } = await import("./bot/notifier.js");
      expect(sendError).not.toHaveBeenCalled();
      await expect(
        mocks.runWithStorageMock.mock.results[0].value,
      ).resolves.toMatchObject({
        failed: false,
      });
      expect(result).toMatchObject({ trigger: "manual", failed: false });
      expect(runner.getLastRun()).toBe(result);
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(false, [{}]);
      const { logRunMetadata } = await import("./runnerMetadata.js");
      expect(logRunMetadata).toHaveBeenCalledWith(
        { node: { main: ["GET parent.test"] } },
        domains,
      );
    });

    it("fails the run when an account fails to scrape", async () => {
      mocks.scrapeAccountsMock.mockResolvedValue({
        results: [
          accountResult(CompanyTypes.hapoalim, true),
          accountResult(CompanyTypes.oneZero, false),
        ],
        domains: {},
      });

      expect(await runOnce("manual")).toMatchObject({ failed: true });
    });

    it("fails the run when a storage reports an error", async () => {
      const report = createRunReport();
      report.storages.sql = { state: "error", message: "boom" };
      mocks.runWithStorageMock.mockImplementation(async (runScraper) => {
        await runScraper(hooks());
        return report;
      });

      expect(await runOnce("manual")).toMatchObject({ failed: true });
    });

    it("fails the run when the report records an error", async () => {
      const report = createRunReport();
      report.failed = true;
      mocks.runWithStorageMock.mockResolvedValue(report);

      expect(await runOnce("manual")).toMatchObject({ failed: true });
    });

    it("fails the run when scraping throws", async () => {
      mocks.scrapeAccountsMock.mockRejectedValue(new Error("scraping failed"));

      expect(await runOnce("manual")).toMatchObject({ failed: true });
    });

    it("preserves an error callback failure even when accounts succeed", async () => {
      mocks.scrapeAccountsMock.mockImplementation(
        async (_config, _status, onError) => {
          await onError?.(new Error("browser close failed"), "browser.close");
          return {
            results: [accountResult(CompanyTypes.hapoalim, true)],
            domains: {},
          };
        },
      );

      expect(await runOnce("manual")).toMatchObject({ failed: true });
    });

    it("fails the run when the storage wrapper throws", async () => {
      mocks.runWithStorageMock.mockRejectedValue(new Error("exploded"));

      expect(await runOnce("manual")).toMatchObject({ failed: true });
    });

    it("delivers logs without storage clients when storage construction fails and permits retry", async () => {
      const { createStorages } = await import("./bot/storage/index.js");
      jest.mocked(createStorages).mockImplementationOnce(() => {
        throw new Error("storage setup failed");
      });

      expect(await runOnce("manual")).toMatchObject({ failed: true });
      expect(mocks.scrapeAccountsMock).not.toHaveBeenCalled();
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(false, []);
      expect(await runOnce("manual")).toMatchObject({ failed: false });
    });

    it("retains the run's storage clients for logs when tracker construction fails", async () => {
      const { createDomainTracker } = await import("./security/domains.js");
      const { createStorages } = await import("./bot/storage/index.js");
      jest.mocked(createDomainTracker).mockImplementationOnce(() => {
        throw new Error("tracker setup failed");
      });

      expect(await runOnce("manual")).toMatchObject({ failed: true });
      expect(mocks.scrapeAccountsMock).not.toHaveBeenCalled();
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(
        false,
        jest.mocked(createStorages).mock.results[0].value,
      );
    });

    it("finishes tracking before log delivery, retaining the clients when tracker cleanup fails", async () => {
      const { createDomainTracker } = await import("./security/domains.js");
      const { createStorages } = await import("./bot/storage/index.js");
      const dispose = jest.fn(() => {
        throw new Error("tracker cleanup failed");
      });
      const tracker = mock<ReturnType<typeof createDomainTracker>>();
      tracker.dispose.mockImplementation(dispose);
      tracker.getUsedDomains.mockResolvedValue({});
      jest.mocked(createDomainTracker).mockReturnValueOnce(tracker);
      mocks.runWithStorageMock.mockRejectedValueOnce(
        new Error("storage operation failed"),
      );

      expect(await runOnce("manual")).toMatchObject({ failed: true });
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(
        false,
        jest.mocked(createStorages).mock.results[0].value,
      );
      expect(dispose.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.sendLogFileMock.mock.invocationCallOrder[0],
      );
      expect(await runner.isRunning()).toBe(false);
    });

    it("does not carry a failure over to the next run", async () => {
      mocks.runWithStorageMock.mockRejectedValueOnce(new Error("exploded"));
      await runOnce("manual");

      expect(await runOnce("manual")).toMatchObject({ failed: false });
    });

    it("hands the run back before it finishes, so a caller can answer honestly", async () => {
      let releaseRun!: () => void;
      mocks.runWithStorageMock.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
        return createRunReport();
      });

      const handle = await runner.startRun("manual");

      expect(handle.started).toBe(true);
      expect(await runner.isRunning()).toBe(true);

      releaseRun();
      await expect(handle.finished).resolves.toMatchObject({ failed: false });
    });

    it("reports a second run while one is in flight as not started", async () => {
      let releaseRun!: () => void;
      const runIsHolding = new Promise<void>((resolve) => {
        releaseRun = resolve;
      });
      mocks.runWithStorageMock.mockImplementation(async (runScraper) => {
        await runScraper(hooks());
        await runIsHolding;
        return createRunReport();
      });

      const first = runOnce("manual");
      await new Promise((resolve) => setImmediate(resolve));

      expect(await runner.isRunning()).toBe(true);
      expect((await runner.startRun("manual")).started).toBe(false);

      releaseRun();
      await expect(first).resolves.toMatchObject({ failed: false });
      expect(await runner.isRunning()).toBe(false);
    });

    it("shares one run id between the storages and the log upload", async () => {
      const runIds: Array<string | undefined> = [];
      const recordRunId = () =>
        runIds.push(mocks.runContextStore.getStore()?.runId);
      mocks.runWithStorageMock.mockImplementation(async () => {
        recordRunId();
        return createRunReport();
      });
      mocks.sendLogFileMock.mockImplementation(async () => {
        recordRunId();
      });

      await runOnce("manual");
      await runOnce("manual");

      expect(runIds).toHaveLength(4);
      expect(runIds[0]).toEqual(expect.any(String));
      expect(runIds[1]).toBe(runIds[0]);
      expect(runIds[2]).toBe(runIds[3]);
      expect(runIds[2]).not.toBe(runIds[0]);
    });

    it("releases the lock when the log upload fails", async () => {
      mocks.sendLogFileMock.mockRejectedValueOnce(new Error("boom"));

      const handle = await runner.startRun("manual");
      await expect(handle.finished).rejects.toThrow("boom");
      expect(await runner.isRunning()).toBe(false);
    });
  });
});
