import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { workerEnvironment } from "./scraper/environment.js";

jest.mock("dotenv/config", () => ({}));
jest.mock("node:fs", () => {
  const actual = jest.requireActual<typeof import("node:fs")>("node:fs");
  return { ...actual, readFileSync: jest.fn(actual.readFileSync) };
});
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
  let directory: string;

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
    directory = mkdtempSync(path.join(process.cwd(), ".config-secret-test-"));
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
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

  it.each(["JSON", "JSONC"])(
    "loads a mounted %s descriptor without copying it into the environment",
    async (format) => {
      const file = path.join(directory, "provider.json");
      const fileDescriptor =
        format === "JSONC" ? `/* descriptor */\n${descriptor}` : descriptor;
      writeFileSync(file, fileDescriptor);
      process.env.MONEYMAN_CONFIG_SECRET = file;
      const environment = { ...process.env };
      const { execFileSync } = await import("node:child_process");
      jest.mocked(execFileSync).mockReturnValueOnce(
        JSON.stringify({
          MONEYMAN_CONFIG:
            '{"accounts":[{"companyId":"hapoalim","password":"invented-file-bank"}]}',
        }),
      );

      const { config, configSecret } = await import("./config.js");
      expect(configSecret).toBe(fileDescriptor);
      expect(config.accounts[0].password).toBe("invented-file-bank");
      expect(execFileSync).toHaveBeenCalledWith(
        process.execPath,
        expect.any(Array),
        expect.objectContaining({
          env: {
            ...workerEnvironment(process.env),
            VARLOCK_TELEMETRY_DISABLED: "1",
            BITWARDEN_ACCESS_TOKEN: "startup-machine-token",
            MONEYMAN_CONFIG_SECRET_ID: "12345678-1234-4234-8234-123456789abc",
          },
        }),
      );
      expect(process.env).toEqual(environment);
      expect(mockPublicLog).not.toHaveBeenCalled();
      expect(JSON.stringify(mockPrivateLog.mock.calls)).not.toContain(
        descriptor,
      );
    },
  );

  it.each([
    descriptor,
    `/* descriptor */\n${descriptor}`,
    `// descriptor\n${descriptor}`,
  ])(
    "uses valid inline JSON/JSONC without trying to read a file: %s",
    async (inline) => {
      process.env.MONEYMAN_CONFIG_SECRET = inline;
      const { readFileSync } = await import("node:fs");
      const { execFileSync } = await import("node:child_process");
      jest.mocked(execFileSync).mockReturnValueOnce('{"MONEYMAN_CONFIG":"{}"}');
      const { configSecret } = await import("./config.js");
      expect(configSecret).toBe(inline);
      expect(execFileSync).toHaveBeenCalledTimes(1);
      expect(readFileSync).not.toHaveBeenCalled();
      expect(mockPublicLog).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, ""])(
    "keeps legacy configuration when the provider input is %j",
    async (value) => {
      process.env.MONEYMAN_CONFIG_SECRET = value;
      process.env.MONEYMAN_CONFIG = '{"options":{"scraping":{"daysBack":17}}}';
      const { config } = await import("./config.js");
      const { execFileSync } = await import("node:child_process");
      const { readFileSync } = await import("node:fs");
      expect(config.options.scraping.daysBack).toBe(17);
      expect(execFileSync).not.toHaveBeenCalled();
      expect(readFileSync).not.toHaveBeenCalled();
    },
  );

  it("fails safely when malformed inline JSON is not a readable file path", async () => {
    process.env.MONEYMAN_CONFIG_SECRET =
      '{"provider":"bitwarden","accessToken":"invented-sensitive-token"';
    await expect(import("./config.js")).rejects.toEqual(
      new Error("Unable to load secret provider descriptor."),
    );
    const { execFileSync } = await import("node:child_process");
    expect(execFileSync).not.toHaveBeenCalled();
    expect(mockPublicLog).not.toHaveBeenCalled();
  });

  it.each([
    "missing",
    "unreadable",
    "empty",
    "whitespace",
    "malformed",
    "unsupported-provider",
    "invalid-descriptor",
  ])(
    "fails closed on %s descriptor files without leaking inputs",
    async (failure) => {
      const { readFileSync } = await import("node:fs");
      const file = path.join(directory, "invented-private-provider.json");
      const contents = {
        empty: "",
        whitespace: " \n\t",
        malformed: '{"accessToken":"invented-sensitive-token"',
        "unsupported-provider":
          '{"provider":"invented-sensitive-provider","accessToken":"invented-sensitive-token"}',
        "invalid-descriptor":
          '{"provider":"bitwarden","secretId":"invented-sensitive-id","accessToken":"invented-sensitive-token"}',
      };
      if (failure in contents) {
        writeFileSync(file, contents[failure as keyof typeof contents]);
      }
      if (failure === "unreadable") {
        jest.mocked(readFileSync).mockImplementationOnce(() => {
          throw new Error("invented-sensitive-filesystem-error");
        });
      }
      process.env.MONEYMAN_CONFIG_SECRET = file;
      const environment = { ...process.env };
      const expectedError = [
        "malformed",
        "unsupported-provider",
        "invalid-descriptor",
      ].includes(failure)
        ? safeError
        : "Unable to load secret provider descriptor.";
      await expect(import("./config.js")).rejects.toEqual(
        new Error(expectedError),
      );
      const { execFileSync } = await import("node:child_process");
      expect(execFileSync).not.toHaveBeenCalled();
      expect(readFileSync).toHaveBeenCalledTimes(1);
      expect(process.env).toEqual(environment);
      expect(JSON.stringify(mockPublicLog.mock.calls)).not.toContain(
        "invented-sensitive",
      );
      expect(mockPrivateLog).not.toHaveBeenCalledWith(
        "Configuration successfully loaded from secret provider",
      );
    },
  );

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
