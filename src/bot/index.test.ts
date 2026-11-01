import { mock } from "jest-mock-extended";
import type { Runner, TransactionStorage } from "../types.js";
import { readReportLogs } from "../utils/secure-log.js";
import { runWithStorage } from "./index.js";
import { createReportPublisher } from "./reportPublisher.js";
import { createRunReport } from "./runReport.js";
import { config } from "../config.js";
import { NotificationOptionsSchema } from "../config.schema.js";
import { readFile } from "node:fs/promises";
import type { ReportTransport } from "./reportPublisher.js";
import * as notifier from "./notifier.js";

jest.mock("./storage/index.js", () => ({ saveResults: jest.fn() }));
jest.mock("./notifier.js", () => ({
  __esModule: true,
  reportTransport: jest
    .requireActual<typeof import("jest-mock-extended")>("jest-mock-extended")
    .mock<ReportTransport>(),
}));
jest.mock("node:fs/promises", () => ({ readFile: jest.fn() }));
jest.mock("../config.js", () => ({
  config: { options: { notifications: {} } },
}));
jest.mock("../utils/secure-log.js", () => ({
  readReportLogs: jest.fn(),
}));
jest.mock("./reportPublisher.js", () => ({
  createReportPublisher: jest.fn(),
}));

describe("runWithStorage report logs", () => {
  const finish = jest.fn().mockResolvedValue(false);

  beforeEach(() => {
    jest.clearAllMocks();
    config.options.notifications = NotificationOptionsSchema.parse({
      telegram: { apiKey: "test-token", chatId: "1" },
    });
    jest.mocked(readReportLogs).mockReturnValue("captured logs");
    jest.mocked(createReportPublisher).mockReturnValue({
      report: createRunReport(),
      finish,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(["disabled", "unconfigured", "uninitialized"])(
    "skips screenshot reads and report logs when Telegram reports are %s",
    async (condition) => {
      if (condition === "disabled") {
        config.options.notifications.telegram!.sendReportFileToTelegram = false;
      } else if (condition === "unconfigured") {
        delete config.options.notifications.telegram;
      } else {
        expect(
          config.options.notifications.telegram?.sendReportFileToTelegram,
        ).toBe(true);
        jest.replaceProperty(notifier, "reportTransport", undefined);
      }
      const runner: Runner = async ({
        failureScreenshotsHandler,
        onStatusChanged,
      }) => {
        await onStatusChanged(["Still scraping"]);
        await failureScreenshotsHandler([
          { photoPath: "invented-screenshot.png", caption: "Failure" },
        ]);
      };

      const publication = await runWithStorage(runner, [
        mock<TransactionStorage>(),
      ]);

      expect(createReportPublisher).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sendReportFile: false }),
      );
      expect(readFile).not.toHaveBeenCalled();
      expect(readReportLogs).not.toHaveBeenCalled();
      expect(finish).toHaveBeenCalledWith(undefined);
      expect(publication).toMatchObject({
        report: {
          scrape: { status: ["Still scraping"] },
          screenshots: [],
        },
        reportSent: false,
        logsSent: false,
      });
    },
  );

  it("embeds screenshots when the parsed default enables reports", async () => {
    jest.mocked(readFile).mockResolvedValue(Buffer.from("invented image"));
    await runWithStorage(
      async ({ failureScreenshotsHandler }) => {
        await failureScreenshotsHandler([
          { photoPath: "invented-screenshot.png", caption: "Failure" },
        ]);
      },
      [mock<TransactionStorage>()],
    );

    expect(readFile).toHaveBeenCalledWith("invented-screenshot.png");
    expect(createReportPublisher).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sendReportFile: true }),
    );
  });

  it("reads logs after scraping and passes them to the final report", async () => {
    const runner = jest.fn<ReturnType<Runner>, Parameters<Runner>>(async () => {
      expect(readReportLogs).not.toHaveBeenCalled();
    });

    await runWithStorage(runner, [mock<TransactionStorage>()]);

    expect(readReportLogs).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith("captured logs");
  });

  it("updates timing entries by ID and ends the run before publishing", async () => {
    const startedAt = 1_000;
    const runner: Runner = async ({ onTiming }) => {
      await onTiming?.({
        id: "account-1",
        kind: "scraper",
        name: "same-bank",
        startedAt,
      });
      await onTiming?.({
        id: "account-2",
        kind: "scraper",
        name: "same-bank",
        startedAt,
      });
      await onTiming?.({
        id: "account-1",
        kind: "scraper",
        name: "same-bank",
        startedAt,
        endedAt: 1_100,
        failed: true,
      });
    };
    finish.mockImplementationOnce(async () => {
      const current = jest.mocked(createReportPublisher).mock.results.at(-1)!
        .value.report;
      expect(current.endedAt).toBeInstanceOf(Date);
      return false;
    });
    const { report: result } = await runWithStorage(runner, [
      mock<TransactionStorage>(),
    ]);
    expect(result.timings).toEqual([
      {
        id: "account-1",
        kind: "scraper",
        name: "same-bank",
        startedAt,
        endedAt: 1_100,
        failed: true,
      },
      { id: "account-2", kind: "scraper", name: "same-bank", startedAt },
    ]);
    expect(result.endedAt).toBeInstanceOf(Date);
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
