import type { AccountScrapeResult, RunnerHooks } from "./types.js";
import type { ServerRunner } from "./server.js";
import { createRunReport } from "./bot/runReport.js";

jest.mock("./config.js", () => ({
  getScraperConfig: jest.fn(() => ({})),
  sendConfigToTelegramIfRequested: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./scraper/index.js", () => ({ scrapeAccounts: jest.fn() }));
jest.mock("./bot/index.js", () => ({ runWithStorage: jest.fn() }));
jest.mock("./bot/notifier.js", () => ({ sendError: jest.fn() }));
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
  monitorNodeConnections: jest.fn(),
}));
jest.mock("./utils/failureScreenshot.js", () => ({
  sendFailureScreenShots: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./utils/logger.js", () => ({ createLogger: () => jest.fn() }));

const accountResult = (companyId: string, success: boolean) =>
  ({ companyId, result: { success } }) as unknown as AccountScrapeResult;

function hooks(): RunnerHooks {
  return {
    onBeforeStart: jest.fn().mockResolvedValue(undefined),
    onStatusChanged: jest.fn().mockResolvedValue(undefined),
    onResultsReady: jest.fn().mockResolvedValue(undefined),
    onError: jest.fn().mockResolvedValue(undefined),
    failureScreenshotsHandler: jest.fn().mockResolvedValue(undefined),
  };
}

async function loadEntrypoint(longRunning: boolean) {
  jest.resetModules();
  process.env.MONEYMAN_LONG_RUNNING = longRunning ? "true" : "";
  let started!: () => void;
  const startup = new Promise<void>((resolve) => (started = resolve));
  const exit = jest
    .spyOn(process, "exit")
    .mockImplementation((() => started()) as never);

  const { scrapeAccounts } = await import("./scraper/index.js");
  const { runWithStorage } = await import("./bot/index.js");
  const { sendLogFile } = await import("./utils/secure-log.js");
  const { startServer } = await import("./server.js");
  const { runContextStore } = await import("./utils/asyncContext.js");
  const scrapeAccountsMock = jest.mocked(scrapeAccounts);
  const runWithStorageMock = jest.mocked(runWithStorage);
  const startServerMock = jest.mocked(startServer);
  scrapeAccountsMock.mockResolvedValue([]);
  runWithStorageMock.mockImplementation(async (runScraper) => {
    await runScraper(hooks());
    return createRunReport();
  });
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

  afterEach(() => {
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

  describe("long running", () => {
    let mocks: Awaited<ReturnType<typeof loadEntrypoint>>;
    let runner: ServerRunner;

    beforeEach(async () => {
      process.env = { ...originalEnv };
      mocks = await loadEntrypoint(true);
      runner = mocks.startServerMock.mock.calls[0][0];
    });

    it("hands the runner to the server without running", () => {
      expect(mocks.runWithStorageMock).not.toHaveBeenCalled();
      expect(mocks.exit).not.toHaveBeenCalled();
    });

    it("reports a run where everything worked as successful", async () => {
      mocks.scrapeAccountsMock.mockResolvedValue([
        accountResult("hapoalim", true),
      ]);

      const result = await runner.runOnce("manual");

      expect(result).toMatchObject({ trigger: "manual", failed: false });
      expect(runner.getLastRun()).toBe(result);
      expect(mocks.sendLogFileMock).toHaveBeenCalledWith(false);
    });

    it("fails the run when an account fails to scrape", async () => {
      mocks.scrapeAccountsMock.mockResolvedValue([
        accountResult("hapoalim", true),
        accountResult("oneZero", false),
      ]);

      expect(await runner.runOnce("manual")).toMatchObject({ failed: true });
    });

    it("fails the run when a storage reports an error", async () => {
      const report = createRunReport();
      report.storages.sql = { state: "error", message: "boom" };
      mocks.runWithStorageMock.mockImplementation(async (runScraper) => {
        await runScraper(hooks());
        return report;
      });

      expect(await runner.runOnce("manual")).toMatchObject({ failed: true });
    });

    it("fails the run when the storage wrapper throws", async () => {
      mocks.runWithStorageMock.mockRejectedValue(new Error("exploded"));

      expect(await runner.runOnce("manual")).toMatchObject({ failed: true });
    });

    it("does not carry a failure over to the next run", async () => {
      mocks.runWithStorageMock.mockRejectedValueOnce(new Error("exploded"));
      await runner.runOnce("manual");

      expect(await runner.runOnce("manual")).toMatchObject({ failed: false });
    });

    it("rejects a second run while one is in flight", async () => {
      let releaseRun!: () => void;
      const runIsHolding = new Promise<void>((resolve) => {
        releaseRun = resolve;
      });
      mocks.runWithStorageMock.mockImplementation(async (runScraper) => {
        await runScraper(hooks());
        await runIsHolding;
        return createRunReport();
      });

      const first = runner.runOnce("manual");
      await new Promise((resolve) => setImmediate(resolve));

      expect(await runner.isRunning()).toBe(true);
      await expect(runner.runOnce("manual")).rejects.toThrow(
        "A scrape is already in progress",
      );

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

      await runner.runOnce("manual");
      await runner.runOnce("manual");

      expect(runIds).toHaveLength(4);
      expect(runIds[0]).toEqual(expect.any(String));
      expect(runIds[1]).toBe(runIds[0]);
      expect(runIds[2]).toBe(runIds[3]);
      expect(runIds[2]).not.toBe(runIds[0]);
    });

    it("releases the lock when the log upload fails", async () => {
      mocks.sendLogFileMock.mockRejectedValueOnce(new Error("boom"));

      await expect(runner.runOnce("manual")).rejects.toThrow("boom");
      expect(await runner.isRunning()).toBe(false);
    });
  });
});
