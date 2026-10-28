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

type SecureLog = typeof import("./secure-log.js");

describe("assertLongRunningLogMode", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    mockLoggerState.unsafeStdout = false;
  });

  /** The env and the unsafe-stdout flag are read when the module loads */
  async function load(env: NodeJS.ProcessEnv): Promise<SecureLog> {
    jest.resetModules();
    process.env = env;
    return await import("./secure-log.js");
  }

  it("accepts a run without a log file", async () => {
    const { assertLongRunningLogMode } = await load({ ...originalEnv });

    expect(() => assertLongRunningLogMode()).not.toThrow();
  });

  it("rejects the long running server when the entrypoint was not told", async () => {
    const { assertLongRunningLogMode } = await load({
      ...originalEnv,
      MONEYMAN_LOG_FILE_PATH: "/tmp/moneyman.log",
    });

    expect(() => assertLongRunningLogMode()).toThrow(
      /MONEYMAN_LONG_RUNNING is not set/,
    );
  });

  it("accepts the long running server when the entrypoint was told", async () => {
    const { assertLongRunningLogMode } = await load({
      ...originalEnv,
      MONEYMAN_LOG_FILE_PATH: "/tmp/moneyman.log",
      MONEYMAN_LONG_RUNNING: "true",
    });

    expect(() => assertLongRunningLogMode()).not.toThrow();
  });

  it("accepts a log file when stdout is used instead", async () => {
    mockLoggerState.unsafeStdout = true;
    const { assertLongRunningLogMode } = await load({
      ...originalEnv,
      MONEYMAN_LOG_FILE_PATH: "/tmp/moneyman.log",
    });

    expect(() => assertLongRunningLogMode()).not.toThrow();
  });
});
