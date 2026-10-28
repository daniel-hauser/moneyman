import { isRunning, runOnce } from "./runner.js";
import { scrapeAccounts } from "./scraper/index.js";
import { runWithStorage } from "./bot/index.js";
import { sendAndDeleteLogFile } from "./utils/secure-log.js";
import type { AccountScrapeResult, RunnerHooks } from "./types.js";
import { createRunReport, type RunReport } from "./bot/runReport.js";

jest.mock("./config.js", () => ({
  getScraperConfig: jest.fn(() => ({})),
  sendConfigToTelegramIfRequested: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("./scraper/index.js", () => ({ scrapeAccounts: jest.fn() }));

jest.mock("./bot/index.js", () => ({ runWithStorage: jest.fn() }));

jest.mock("./utils/secure-log.js", () => ({
  enableDebugLoggingIfNeeded: jest.fn(),
  sendAndDeleteLogFile: jest.fn().mockResolvedValue(undefined),
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

const scrapeAccountsMock = scrapeAccounts as jest.MockedFunction<
  typeof scrapeAccounts
>;
const runWithStorageMock = runWithStorage as jest.MockedFunction<
  typeof runWithStorage
>;
const sendAndDeleteLogFileMock = sendAndDeleteLogFile as jest.MockedFunction<
  typeof sendAndDeleteLogFile
>;

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

/** Drive the scraper from the mocked storage wrapper with a report of its own */
function storageRun(report: RunReport) {
  runWithStorageMock.mockImplementation(async (runScraper) => {
    await runScraper(hooks());
    return report;
  });
}

describe("runOnce", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    scrapeAccountsMock.mockResolvedValue([]);
    sendAndDeleteLogFileMock.mockResolvedValue(undefined);
  });

  it("reports a run where everything worked as successful", async () => {
    scrapeAccountsMock.mockResolvedValue([accountResult("hapoalim", true)]);
    const report = createRunReport();
    report.storages.sql = { state: "done" } as RunReport["storages"][string];
    storageRun(report);

    const result = await runOnce("manual");

    expect(result.failed).toBe(false);
  });

  it("fails the run when an account fails to scrape", async () => {
    scrapeAccountsMock.mockResolvedValue([
      accountResult("hapoalim", true),
      accountResult("oneZero", false),
    ]);
    storageRun(createRunReport());

    const result = await runOnce("manual");

    expect(result.failed).toBe(true);
  });

  it("fails the run when a storage reports an error", async () => {
    scrapeAccountsMock.mockResolvedValue([accountResult("hapoalim", true)]);
    const report = createRunReport();
    report.storages.sql = { state: "error", message: "boom" };
    storageRun(report);

    const result = await runOnce("manual");

    expect(result.failed).toBe(true);
  });

  it("fails the run when the storage wrapper throws", async () => {
    runWithStorageMock.mockRejectedValue(new Error("storage exploded"));

    const result = await runOnce("manual");

    expect(result.failed).toBe(true);
  });

  it("rejects a second run while one is in flight", async () => {
    scrapeAccountsMock.mockResolvedValue([accountResult("hapoalim", true)]);
    let releaseRun!: () => void;
    const runIsHolding = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    runWithStorageMock.mockImplementation(async (runScraper) => {
      await runScraper(hooks());
      await runIsHolding;
      return createRunReport();
    });

    const first = runOnce("manual");
    await new Promise((resolve) => setImmediate(resolve));

    expect(isRunning()).toBe(true);
    await expect(runOnce("manual")).rejects.toThrow(
      "A scrape is already in progress",
    );

    releaseRun();
    await expect(first).resolves.toMatchObject({ failed: false });
    expect(isRunning()).toBe(false);
  });

  it("hands the run id of the run to the log upload", async () => {
    scrapeAccountsMock.mockResolvedValue([accountResult("hapoalim", true)]);
    storageRun(createRunReport());

    await runOnce("manual");

    const runId = runWithStorageMock.mock.calls[0][1];
    expect(typeof runId).toBe("string");
    expect(runId).not.toHaveLength(0);
    expect(sendAndDeleteLogFileMock).toHaveBeenCalledWith(runId);
  });
});
