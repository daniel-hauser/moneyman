const mockLoggerState = { unsafeStdout: false };

jest.mock("../bot/notifier.js", () => ({
  sendTextFile: jest.fn(async () => {}),
}));
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
import { join } from "path";

describe("secure logs", () => {
  const originalEnv = process.env;
  let logFilePath: string;

  beforeEach(() => {
    jest.resetModules();
    mockLoggerState.unsafeStdout = false;

    logFilePath = join(
      mkdtempSync(join(process.cwd(), ".moneyman-log-test-")),
      "moneyman.log",
    );
    writeFileSync(logFilePath, "the logs of the run");
    process.env = {
      ...originalEnv,
      MONEYMAN_LOG_FILE_PATH: logFilePath,
      MONEYMAN_TELEMETRY_FILE_PATH: `${logFilePath}.otel.jsonl`,
    };
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
    const first = mock<MoneymanDashStorage>();
    const second = mock<MoneymanDashStorage>();
    first.sendLogs.mockRejectedValue(new Error("storage failed"));
    second.sendLogs.mockResolvedValue(undefined);
    const { sendLogFile } = await import("./secure-log.js");

    await sendLogFile(false, [first, second]);

    expect(first.sendLogs).toHaveBeenCalledWith("the logs of the run");
    expect(second.sendLogs).toHaveBeenCalledWith("the logs of the run");
    expect(readFileSync(logFilePath, "utf-8")).toBe("");
  });

  it.each([true, false])(
    "uploads to storages and cleans up without a standalone Telegram file (delete=%s)",
    async (deleteFile) => {
      const { config } = await import("../config.js");
      const { sendTextFile } = await import("../bot/notifier.js");
      const { logToPublicLog } = await import("./logger.js");
      config.options.notifications.telegram = {
        apiKey: "test-token",
        chatId: "555",
        sendLogFileToTelegram: true,
        sendReportFileToTelegram: true,
        enableOtp: false,
        otpTimeoutSeconds: 300,
        updateIntervalMs: 500,
      };
      const storage = mock<MoneymanDashStorage>();
      storage.sendLogs.mockResolvedValue(undefined);
      const { sendLogFile } = await import("./secure-log.js");

      await sendLogFile(deleteFile, [storage], true);

      expect(sendTextFile).not.toHaveBeenCalled();
      expect(storage.sendLogs).toHaveBeenCalledWith("the logs of the run");
      expect(logToPublicLog).not.toHaveBeenCalledWith(
        expect.stringContaining("no log destinations"),
        expect.anything(),
      );
      if (deleteFile) expect(existsSync(logFilePath)).toBe(false);
      else expect(readFileSync(logFilePath, "utf-8")).toBe("");
    },
  );

  it("reads captured logs for the report with the backwards-compatible default", async () => {
    const { config } = await import("../config.js");
    const { NotificationOptionsSchema } = await import("../config.schema.js");
    config.options.notifications = NotificationOptionsSchema.parse({
      telegram: { apiKey: "test-token", chatId: "555" },
    });
    const { readReportLogs } = await import("./secure-log.js");
    expect(config.options.notifications.telegram?.sendLogFileToTelegram).toBe(
      true,
    );
    expect(readReportLogs()).toBe("the logs of the run");
    expect(readFileSync(logFilePath, "utf-8")).toBe("the logs of the run");
  });

  it("reads console and OTLP separately for the explorer without changing legacy uploads", async () => {
    const telemetry = '{"resourceSpans":[]}\n';
    writeFileSync(`${logFilePath}.otel.jsonl`, telemetry);
    const { config } = await import("../config.js");
    const { NotificationOptionsSchema } = await import("../config.schema.js");
    config.options.notifications = NotificationOptionsSchema.parse({
      telegram: { apiKey: "invented-token", chatId: "invented-chat" },
    });
    const { readReportLogs } = await import("./secure-log.js");
    expect(readReportLogs(true)).toEqual({
      console: "the logs of the run",
      telemetry,
    });
    expect(readReportLogs()).toBe(`the logs of the run\n${telemetry}`);
  });

  it.each([true, false])(
    "retains telemetry in reports, standalone delivery and storage uploads (delete=%s)",
    async (deleteFile) => {
      const telemetryPath = `${logFilePath}.otel.jsonl`;
      const telemetry = '{"resourceSpans":[]}\n';
      writeFileSync(telemetryPath, telemetry, { mode: 0o600 });
      const { config } = await import("../config.js");
      const { NotificationOptionsSchema } = await import("../config.schema.js");
      config.options.notifications = NotificationOptionsSchema.parse({
        telegram: { apiKey: "invented-token", chatId: "invented-chat" },
      });
      const { readReportLogs, sendLogFile } = await import("./secure-log.js");
      const { sendTextFile } = await import("../bot/notifier.js");
      const storage = mock<MoneymanDashStorage>();
      storage.sendLogs.mockResolvedValue(undefined);
      const combined = `the logs of the run\n${telemetry}`;
      expect(readReportLogs()).toBe(combined);
      await sendLogFile(deleteFile, [storage]);
      expect(sendTextFile).toHaveBeenCalledWith(logFilePath);
      expect(sendTextFile).toHaveBeenCalledWith(telemetryPath);
      expect(storage.sendLogs).toHaveBeenCalledWith(combined);
      if (deleteFile) expect(existsSync(telemetryPath)).toBe(false);
      else expect(readFileSync(telemetryPath, "utf8")).toBe("");
    },
  );

  it("does not include private telemetry when log consent is disabled", async () => {
    writeFileSync(`${logFilePath}.otel.jsonl`, '{"resourceLogs":[]}\n');
    const { config } = await import("../config.js");
    const { NotificationOptionsSchema } = await import("../config.schema.js");
    config.options.notifications = NotificationOptionsSchema.parse({
      telegram: {
        apiKey: "invented-token",
        chatId: "invented-chat",
        sendLogFileToTelegram: false,
      },
    });
    const { readReportLogs } = await import("./secure-log.js");
    expect(readReportLogs()).toBeUndefined();
    expect(readReportLogs(true)).toBeUndefined();
  });
  it.each([
    "disabled",
    "report disabled",
    "unconfigured",
    "unsafe",
    "no path",
    "missing",
    "unreadable",
  ])("omits report logs when %s", async (condition) => {
    const { config } = await import("../config.js");
    config.options.notifications.telegram = {
      apiKey: "test-token",
      chatId: "555",
      sendLogFileToTelegram: condition !== "disabled",
      sendReportFileToTelegram: condition !== "report disabled",
      enableOtp: false,
      otpTimeoutSeconds: 300,
      updateIntervalMs: 500,
    };
    if (condition === "unconfigured") {
      delete config.options.notifications.telegram;
    }
    if (condition === "unsafe") mockLoggerState.unsafeStdout = true;
    if (condition === "no path") delete process.env.MONEYMAN_LOG_FILE_PATH;
    if (condition === "missing") rmSync(logFilePath);
    if (condition === "unreadable") {
      process.env.MONEYMAN_LOG_FILE_PATH = join(logFilePath, "..");
    }
    const { readReportLogs } = await import("./secure-log.js");

    expect(readReportLogs()).toBeUndefined();
    expect(readReportLogs(true)).toBeUndefined();
  });

  it.each([true, false])(
    "keeps standalone logs independent when reports are disabled (logs=%s)",
    async (sendLogs) => {
      const { config } = await import("../config.js");
      const { NotificationOptionsSchema } = await import("../config.schema.js");
      config.options.notifications = NotificationOptionsSchema.parse({
        telegram: {
          apiKey: "test-token",
          chatId: "555",
          sendReportFileToTelegram: false,
          sendLogFileToTelegram: sendLogs,
        },
      });
      const { readReportLogs, sendLogFile } = await import("./secure-log.js");
      const { sendTextFile } = await import("../bot/notifier.js");

      expect(readReportLogs()).toBeUndefined();
      await sendLogFile(false);

      if (sendLogs) expect(sendTextFile).toHaveBeenCalledWith(logFilePath);
      else expect(sendTextFile).not.toHaveBeenCalled();
      expect(readFileSync(logFilePath, "utf-8")).toBe("");
    },
  );

  it("warns when neither embedded report logs nor storage logs are configured", async () => {
    const { sendLogFile } = await import("./secure-log.js");
    const { logToPublicLog } = await import("./logger.js");

    await sendLogFile(false);

    expect(logToPublicLog).toHaveBeenCalledWith(
      expect.stringContaining("no log destinations"),
      expect.any(Function),
    );
  });

  it("does not warn when a storage receives logs without Telegram", async () => {
    const storage = mock<MoneymanDashStorage>();
    const { sendLogFile } = await import("./secure-log.js");
    const { logToPublicLog } = await import("./logger.js");

    await sendLogFile(false, [storage]);

    expect(logToPublicLog).not.toHaveBeenCalledWith(
      expect.stringContaining("no log destinations"),
      expect.anything(),
    );
  });
});
