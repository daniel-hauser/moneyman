import path from "node:path";
import { workerEnvironment } from "./scraper/environment.js";

jest.mock("dotenv/config", () => ({}));
jest.mock("node:child_process", () => ({
  ...jest.requireActual("node:child_process"),
  execFileSync: jest.fn(),
}));
const mockPrivateLog = jest.fn();
const mockPublicLog = jest.fn();
jest.mock("./utils/logger.js", () => ({
  createLogger: () => mockPrivateLog,
  logToPublicLog: mockPublicLog,
  unsafeStdout: false,
}));

const descriptor = JSON.stringify({
  provider: "bitwarden",
  secretId: "12345678-1234-4234-8234-123456789abc",
  accessToken: "startup-machine-token",
});
const safeError =
  "Moneyman failed before completion. Sensitive error details were withheld from public logs.";

describe("provider-backed configuration startup", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...workerEnvironment(originalEnv),
      MONEYMAN_CONFIG_SECRET: descriptor,
      MONEYMAN_CONFIG: '{"accounts":[{"password":"stale"}]}',
      MONEYMAN_CONFIG_PATH: "must-not-read.json",
      NODE_OPTIONS: "--require unsafe-hook",
      __VARLOCK_ENV: '{"MONEYMAN_CONFIG":"stale-injected"}',
    };
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("loads once before exposing startup settings without putting resolved secrets in process.env", async () => {
    const { execFileSync } = await import("node:child_process");
    jest.mocked(execFileSync).mockReturnValue(
      JSON.stringify({
        MONEYMAN_CONFIG: JSON.stringify({
          accounts: [{ companyId: "hapoalim", password: "fresh-bank" }],
          storage: {
            webPost: {
              url: "https://storage.test",
              authorizationToken: "fresh-storage",
            },
          },
          options: {
            notifications: {
              telegram: { apiKey: "startup-telegram", chatId: "123" },
            },
            scheduling: { cron: "0 9 * * *" },
            logging: { debugFilter: "startup-debug" },
          },
        }),
      }),
    );
    const environment = { ...process.env };
    const { config, configSecret } = await import("./config.js");
    expect(configSecret).toBe(descriptor);
    expect(config.accounts[0].password).toBe("fresh-bank");
    expect(config.options.notifications.telegram?.apiKey).toBe(
      "startup-telegram",
    );
    expect(config.options.scheduling.cron).toBe("0 9 * * *");
    expect(config.options.logging.debugFilter).toBe("startup-debug");
    expect(config.storage.webPost?.authorizationToken).toBe("fresh-storage");
    expect(process.env).toEqual(environment);
    await import("./config.js");
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith(
      process.execPath,
      [
        path.resolve("node_modules", "varlock", "bin", "cli.js"),
        "load",
        "--format",
        "json",
        "--filter",
        "MONEYMAN_CONFIG",
        "--path",
        path.resolve(".env.schema"),
        "--skip-cache",
      ],
      expect.objectContaining({
        env: {
          ...workerEnvironment(process.env),
          VARLOCK_TELEMETRY_DISABLED: "1",
          BITWARDEN_ACCESS_TOKEN: "startup-machine-token",
          MONEYMAN_CONFIG_SECRET_ID: "12345678-1234-4234-8234-123456789abc",
        },
        encoding: "utf8",
        timeout: 60_000,
        killSignal: "SIGKILL",
      }),
    );
    expect(mockPrivateLog).toHaveBeenCalledWith(
      "Configuration successfully loaded from secret provider",
    );
    expect(mockPublicLog).not.toHaveBeenCalled();
  });

  it("terminates a stalled provider at startup with only a safe public failure", async () => {
    const actual =
      jest.requireActual<typeof import("node:child_process")>(
        "node:child_process",
      );
    const { execFileSync } = await import("node:child_process");
    jest.mocked(execFileSync).mockImplementationOnce((file, _args, options) => {
      expect(options).toEqual(
        expect.objectContaining({ timeout: 60_000, killSignal: "SIGKILL" }),
      );
      return actual.execFileSync(
        file,
        [
          "-e",
          'process.on("SIGTERM", () => {}); console.error("sensitive-timeout-diagnostic"); setInterval(() => {}, 1000)',
        ],
        { ...options, timeout: 300, stdio: "pipe" },
      );
    });

    await expect(import("./config.js")).rejects.toThrow(safeError);
    expect(mockPublicLog).toHaveBeenCalledWith(safeError);
    expect(mockPublicLog).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "Unable to load configuration from secret provider:",
      expect.objectContaining({ code: "ETIMEDOUT", signal: "SIGKILL" }),
    );
    expect(process.env.MONEYMAN_CONFIG).toContain("stale");
  });

  it.each([
    "descriptor",
    "provider",
    "cli-json",
    "missing",
    "config-json",
    "validation",
  ])(
    "fails closed with a safe public notification on %s errors",
    async (failure) => {
      const { execFileSync } = await import("node:child_process");
      if (failure === "descriptor") {
        process.env.MONEYMAN_CONFIG_SECRET = '{"provider":"unsupported"}';
      } else if (failure === "provider") {
        jest.mocked(execFileSync).mockImplementationOnce(() => {
          throw new Error("sensitive-provider-diagnostic");
        });
      } else {
        const values = {
          "config-json": "invalid-sensitive",
          validation: '{"accounts":[{"password":""}]}',
          missing: undefined,
        };
        jest.mocked(execFileSync).mockReturnValueOnce(
          failure === "cli-json"
            ? "invalid-cli-sensitive"
            : JSON.stringify({
                MONEYMAN_CONFIG: values[failure as keyof typeof values],
              }),
        );
      }
      await expect(import("./config.js")).rejects.toThrow(safeError);
      expect(mockPublicLog).toHaveBeenCalledWith(safeError);
      expect(mockPublicLog).toHaveBeenCalledTimes(1);
      expect(mockPrivateLog).not.toHaveBeenCalledWith(
        "Configuration successfully loaded from secret provider",
      );
      expect(console.error).toHaveBeenCalled();
      if (failure === "descriptor") expect(execFileSync).not.toHaveBeenCalled();
    },
  );
});
