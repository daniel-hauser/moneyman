import { mock } from "jest-mock-extended";
import type { Runner, TransactionStorage } from "../types.js";
import { readReportLogs } from "../utils/secure-log.js";
import { runWithStorage } from "./index.js";
import { createReportPublisher } from "./reportPublisher.js";
import { createRunReport } from "./runReport.js";

jest.mock("./storage/index.js", () => ({ saveResults: jest.fn() }));
jest.mock("./notifier.js", () => ({}));
jest.mock("../utils/secure-log.js", () => ({
  readReportLogs: jest.fn(),
}));
jest.mock("./reportPublisher.js", () => ({
  createReportPublisher: jest.fn(),
}));

describe("runWithStorage report logs", () => {
  const finish = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(readReportLogs).mockReturnValue("captured logs");
    jest.mocked(createReportPublisher).mockReturnValue({
      report: createRunReport(),
      finish,
    });
  });

  it("reads logs after scraping and passes them to the final report", async () => {
    const runner = jest.fn<ReturnType<Runner>, Parameters<Runner>>(async () => {
      expect(readReportLogs).not.toHaveBeenCalled();
    });

    await runWithStorage(runner, [mock<TransactionStorage>()]);

    expect(readReportLogs).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith("captured logs");
  });

  it("still finalizes with captured logs when the scraper throws", async () => {
    await expect(
      runWithStorage(async () => {
        throw new Error("scraper failed");
      }, [mock<TransactionStorage>()]),
    ).rejects.toThrow("scraper failed");

    expect(finish).toHaveBeenCalledWith("captured logs");
  });

  it("omits unavailable logs even when no storages are configured", async () => {
    jest.mocked(readReportLogs).mockReturnValue(undefined);

    await runWithStorage(jest.fn(), []);

    expect(finish).toHaveBeenCalledWith(undefined);
  });
});
