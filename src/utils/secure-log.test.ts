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

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
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
});
