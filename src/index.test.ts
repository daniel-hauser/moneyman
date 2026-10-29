import type { AccountScrapeResult, RunnerHooks, RunTrigger } from "./types.js";
import type { ServerRunner } from "./server.js";
import { createRunReport } from "./bot/runReport.js";
import { mock } from "jest-mock-extended";
import { CompanyTypes } from "israeli-bank-scrapers";

jest.mock("./config.js", () => ({
  config: { options: { scraping: {}, security: {} } },
  getScraperConfig: jest.fn(() => ({})),
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
  storages: [{}],
  saveResults: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./bot/notifier.js", () => ({
  sendError: jest.fn().mockResolvedValue(undefined),
  sendPhotos: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./server.js", () => ({ startServer: jest.fn() }));
jest.mock("./utils/secure-log.js", () => ({
  enableDebugLoggingIfNeeded: jest.fn(),
  sendLogFile: jest.fn(),
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

async function loadEntrypoint(longRunning: boolean) {
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
  const scrapeAccountsMock = jest.mocked(scrapeAccounts);
  const runWithStorageMock = jest.mocked(runWithStorage);
  const startServerMock = jest.mocked(startServer);
  scrapeAccountsMock.mockResolvedValue({ results: [], domains: {} });
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
      for (const listener of process.listeners("exit")) {
        if (!originalExitListeners.includes(listener))
          process.removeListener("exit", listener);
      }
    }
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("runs once and exits by default", async () => {
    const { exit, runWithStorageMock, startServerMock, sendLogFileMock } =
      await loadEntrypoint(false);

    expect(runWithStorageMock).toHaveBeenCalledTimes(1);
    expect(startServerMock).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
    expect(sendLogFileMock).toHaveBeenCalledWith(true);
  });

  it("disposes the parent lifetime tracker on process exit", async () => {
    await loadEntrypoint(false);
    const { createDomainTracker } = await import("./security/domains.js");
    const tracker = jest.mocked(createDomainTracker).mock.results[0].value;
    expect(tracker.dispose).not.toHaveBeenCalled();
    process.rawListeners("exit").at(-1)!.call(process, 0);
    expect(tracker.dispose).toHaveBeenCalledTimes(1);
  });

  describe("long running", () => {
    let mocks: Awaited<ReturnType<typeof loadEntrypoint>>;
    let runner: ServerRunner;

    beforeEach(async () => {
      process.env = { ...originalEnv };
      mocks = await loadEntrypoint(true);
      runner = mocks.startServerMock.mock.calls[0][0];
    });

    /** Runs to completion, the way the one-shot entrypoint does. */
    const runOnce = async (trigger: RunTrigger) =>
      (await runner.startRun(trigger)).finished;

    it("hands the runner to the server without running", () => {
      expect(mocks.runWithStorageMock).not.toHaveBeenCalled();
      expect(mocks.exit).not.toHaveBeenCalled();
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
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(false);
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
