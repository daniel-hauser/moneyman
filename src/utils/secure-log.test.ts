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

describe("sendAndDeleteLogFile", () => {
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

  it("empties the log file of a long running process", async () => {
    const { markLongRunningProcess } = await import("./env.js");
    markLongRunningProcess();
    const { sendAndDeleteLogFile } = await import("./secure-log.js");

    await sendAndDeleteLogFile("run-id");

    // The entrypoint holds the file open for the lifetime of the process, so
    // it has to stay in place and be emptied between runs.
    expect(existsSync(logFilePath)).toBe(true);
    expect(readFileSync(logFilePath, "utf-8")).toBe("");
  });

  it("deletes the log file of a one shot process", async () => {
    const { sendAndDeleteLogFile } = await import("./secure-log.js");

    await sendAndDeleteLogFile("run-id");

    expect(existsSync(logFilePath)).toBe(false);
  });

  it("leaves the log file alone when stdout is used instead", async () => {
    mockLoggerState.unsafeStdout = true;
    const { sendAndDeleteLogFile } = await import("./secure-log.js");

    await sendAndDeleteLogFile("run-id");

    expect(readFileSync(logFilePath, "utf-8")).toBe("the logs of the run");
  });
});
