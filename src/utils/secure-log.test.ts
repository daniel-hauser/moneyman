const mockLoggerState = { unsafeStdout: false };

jest.mock("../bot/storage/index.js", () => ({ storages: [] }));
jest.mock("../bot/notifier.js", () => ({ sendTextFile: jest.fn() }));
jest.mock("../config.js", () => ({
  config: { options: { notifications: {} } },
}));
jest.mock("./logger.js", () => ({
  createLogger: () => jest.fn(),
  logToPublicLog: jest.fn(),
  get unsafeStdout() {
    return mockLoggerState.unsafeStdout;
  },
}));

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "fs";
import { mock } from "jest-mock-extended";
import type { MoneymanDashStorage } from "../bot/storage/moneyman.js";
import { tmpdir } from "os";
import { join } from "path";

describe("sendLogFile", () => {
  const originalEnv = process.env;
  let logFilePath: string;

  beforeEach(() => {
    jest.resetModules();
    mockLoggerState.unsafeStdout = false;

    logFilePath = join(
      mkdtempSync(join(tmpdir(), "moneyman-log-")),
      "moneyman.log",
    );
    writeFileSync(logFilePath, "the logs of the run");
    process.env = { ...originalEnv, MONEYMAN_LOG_FILE_PATH: logFilePath };
  });

  afterEach(() => {
    rmSync(join(logFilePath, ".."), { recursive: true, force: true });
    process.env = originalEnv;
  });

  it("empties the log file", async () => {
    const { sendLogFile } = await import("./secure-log.js");

    await sendLogFile(false);

    expect(existsSync(logFilePath)).toBe(true);
    expect(readFileSync(logFilePath, "utf-8")).toBe("");
  });

  it("deletes the log file when requested", async () => {
    const { sendLogFile } = await import("./secure-log.js");

    await sendLogFile(true);

    expect(existsSync(logFilePath)).toBe(false);
  });

  it.each([true, false])(
    "leaves the log file alone when stdout is used instead (deleteFile=%s)",
    async (deleteFile) => {
      mockLoggerState.unsafeStdout = true;
      const { sendLogFile } = await import("./secure-log.js");

      await sendLogFile(deleteFile);

      expect(readFileSync(logFilePath, "utf-8")).toBe("the logs of the run");
    },
  );

  it("tries every storage and clears logs even when a storage upload fails", async () => {
    const { storages } = await import("../bot/storage/index.js");
    const first = mock<MoneymanDashStorage>();
    const second = mock<MoneymanDashStorage>();
    first.sendLogs.mockRejectedValue(new Error("storage failed"));
    second.sendLogs.mockResolvedValue(undefined);
    storages.push(first, second);
    const { sendLogFile } = await import("./secure-log.js");

    await sendLogFile(false);

    expect(first.sendLogs).toHaveBeenCalledWith("the logs of the run");
    expect(second.sendLogs).toHaveBeenCalledWith("the logs of the run");
    expect(readFileSync(logFilePath, "utf-8")).toBe("");
  });

  it.each([true, false])(
    "still uploads to storages and cleans up after Telegram failure (delete=%s)",
    async (deleteFile) => {
      const { config } = await import("../config.js");
      const { sendTextFile } = await import("../bot/notifier.js");
      const { storages } = await import("../bot/storage/index.js");
      const { logToPublicLog } = await import("./logger.js");
      config.options.notifications.telegram = {
        apiKey: "test-token",
        chatId: "555",
        sendLogFileToTelegram: true,
        enableOtp: false,
        otpTimeoutSeconds: 300,
        updateIntervalMs: 500,
      };
      jest.mocked(sendTextFile).mockRejectedValue(new Error("Telegram failed"));
      const storage = mock<MoneymanDashStorage>();
      storage.sendLogs.mockResolvedValue(undefined);
      storages.push(storage);
      const { sendLogFile } = await import("./secure-log.js");

      await sendLogFile(deleteFile);

      expect(sendTextFile).toHaveBeenCalled();
      expect(storage.sendLogs).toHaveBeenCalledWith("the logs of the run");
      expect(logToPublicLog).toHaveBeenCalledWith(
        "Failed to send logs to Telegram",
        expect.any(Function),
      );
      if (deleteFile) expect(existsSync(logFilePath)).toBe(false);
      else expect(readFileSync(logFilePath, "utf-8")).toBe("");
    },
  );
});
