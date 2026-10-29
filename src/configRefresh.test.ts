import type { execFile, ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { mock } from "jest-mock-extended";
import { workerEnvironment } from "./scraper/environment.js";

const mockExecFile = jest.fn<ChildProcess, Parameters<typeof execFile>>();
jest.mock("node:child_process", () => ({
  ...jest.requireActual("node:child_process"),
  execFile: mockExecFile,
}));
jest.mock("./config.js", () => ({
  config: jest
    .requireActual<typeof import("./config.schema.js")>("./config.schema.js")
    .MoneymanConfigSchema.parse({
      options: {
        notifications: { telegram: { apiKey: "startup-token", chatId: "123" } },
        scheduling: { cron: "0 9 * * *" },
        logging: { debugFilter: "startup-filter" },
      },
    }),
}));
const mockPrivateLog = jest.fn();
jest.mock("./utils/logger.js", () => ({
  createLogger: () => mockPrivateLog,
}));

const id = "12345678-1234-4234-8234-123456789abc";
const bootstrap = {
  MONEYMAN_CONFIG_SECRET_PROVIDER: "bitwarden",
  MONEYMAN_CONFIG_SECRET_ID: id,
  BITWARDEN_ACCESS_TOKEN: "machine-token",
};
const remoteConfig = (password: string) => ({
  accounts: [{ companyId: "hapoalim", password }],
  storage: {
    webPost: { url: "https://storage.test", authorizationToken: password },
  },
  options: {
    scraping: { daysBack: 30, maxParallelScrapers: 3 },
    security: { blockByDefault: true, firewallSettings: ["ALLOW bank.test"] },
    notifications: { telegram: { apiKey: "changed-token", chatId: "999" } },
    scheduling: { cron: "0 12 * * *" },
    logging: { debugFilter: "changed-filter" },
  },
});
type Completion = (error: Error | null, stdout: string, stderr: string) => void;

function complete(stdout: string, error: Error | null = null, stderr = "") {
  mockExecFile.mockImplementationOnce((...args: unknown[]) => {
    const callback = args.at(-1) as Completion;
    callback(error, stdout, stderr);
    return mock<ChildProcess>();
  });
}

describe("provider configuration refresh through the Varlock CLI", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockExecFile.mockReset();
    process.env = {
      ...workerEnvironment(originalEnv),
      ...bootstrap,
      MONEYMAN_CONFIG: JSON.stringify(remoteConfig("stale-resolved-secret")),
      MONEYMAN_CONFIG_PATH: "must-not-read.json",
    };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("executes a fresh uncached CLI load on every call and retains startup-only settings", async () => {
    const { execFile } = await import("node:child_process");
    complete(
      JSON.stringify({
        MONEYMAN_CONFIG: JSON.stringify(remoteConfig("first-password")),
      }),
    );
    complete(
      JSON.stringify({
        MONEYMAN_CONFIG: JSON.stringify(remoteConfig("second-password")),
      }),
    );
    const { loadRunConfig, hasConfigSecretProvider } =
      await import("./configRefresh.js");
    const { config } = await import("./config.js");
    expect(hasConfigSecretProvider()).toBe(true);

    const first = await loadRunConfig();
    const second = await loadRunConfig();
    expect(first.accounts[0].password).toBe("first-password");
    expect(second.accounts[0].password).toBe("second-password");
    expect(first.storage.webPost?.authorizationToken).toBe("first-password");
    expect(second.storage.webPost?.authorizationToken).toBe("second-password");
    expect(first.options.scraping.daysBack).toBe(30);
    expect(first.options.security.blockByDefault).toBe(true);
    expect(first.options.notifications).toBe(config.options.notifications);
    expect(first.options.scheduling).toBe(config.options.scheduling);
    expect(first.options.logging).toBe(config.options.logging);
    expect(first.options.notifications.telegram?.apiKey).toBe("startup-token");
    expect(first.options.scheduling.cron).toBe("0 9 * * *");
    expect(first.options.logging.debugFilter).toBe("startup-filter");
    expect(config.accounts).toEqual([]);
    expect(process.env.MONEYMAN_CONFIG).toContain("stale-resolved-secret");
    expect(execFile).toHaveBeenCalledTimes(2);
    for (const [executable, args, options] of jest.mocked(execFile).mock
      .calls) {
      expect(executable).toBe(process.execPath);
      expect(args).toEqual([
        path.resolve("node_modules", "varlock", "bin", "cli.js"),
        "load",
        "--format",
        "json",
        "--filter",
        "MONEYMAN_CONFIG",
        "--path",
        path.resolve(".env.schema"),
        "--skip-cache",
      ]);
      expect(options).toEqual(
        expect.objectContaining({
          env: {
            ...workerEnvironment(process.env),
            VARLOCK_TELEMETRY_DISABLED: "1",
            BITWARDEN_ACCESS_TOKEN: "machine-token",
            MONEYMAN_CONFIG_SECRET_ID: id,
          },
          encoding: "utf8",
        }),
      );
      expect(JSON.stringify(args)).not.toContain("machine-token");
    }
  });

  it("isolates the CLI from resolved config, injected/cache state, startup secrets and executable hooks", async () => {
    process.env = {
      ...process.env,
      MONEYMAN_CONFIG_SECRET: JSON.stringify({
        provider: "bitwarden",
        secretId: id,
        accessToken: "descriptor-token",
      }),
      __VARLOCK_ENV: '{"MONEYMAN_CONFIG":"stale-injected"}',
      _VARLOCK_CACHE_KEY: "cache-key",
      __VARLOCK_PROXY_CHILD: "1",
      VARLOCK_ENV: "stale-env",
      NODE_OPTIONS: "--require unsafe-hook",
      DOTENV_CONFIG_PATH: "unsafe.env",
      DEBUG: "*",
      TELEGRAM_TOKEN: "telegram-secret",
      STORAGE_TOKEN: "storage-secret",
    };
    const { execFile } = await import("node:child_process");
    complete('{"MONEYMAN_CONFIG":"{}"}');
    const { loadRunConfig } = await import("./configRefresh.js");
    await loadRunConfig();
    const options = jest.mocked(execFile).mock.calls[0][2] as {
      env: NodeJS.ProcessEnv;
    };
    expect(options.env).toEqual({
      ...workerEnvironment(process.env),
      VARLOCK_TELEMETRY_DISABLED: "1",
      BITWARDEN_ACCESS_TOKEN: "descriptor-token",
      MONEYMAN_CONFIG_SECRET_ID: id,
    });
    for (const key of Object.keys(process.env)) {
      if (
        !(key in workerEnvironment(process.env)) &&
        !["BITWARDEN_ACCESS_TOKEN", "MONEYMAN_CONFIG_SECRET_ID"].includes(key)
      ) {
        expect(options.env).not.toHaveProperty(key);
      }
    }
    expect(
      JSON.stringify(jest.mocked(execFile).mock.calls[0][1]),
    ).not.toContain("descriptor-token");
  });

  it("does not load the CLI in legacy environment/file mode", async () => {
    process.env = {
      ...workerEnvironment(originalEnv),
      MONEYMAN_CONFIG_PATH: "legacy.json",
    };
    const { loadRunConfig, hasConfigSecretProvider } =
      await import("./configRefresh.js");
    const { config } = await import("./config.js");
    expect(hasConfigSecretProvider()).toBe(false);
    expect(await loadRunConfig()).toBe(config);
    const { execFile } = await import("node:child_process");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("keeps only provider bootstrap inputs startup-bound without mutating process.env", async () => {
    const { loadRunConfig } = await import("./configRefresh.js");
    const { execFile } = await import("node:child_process");
    complete('{"MONEYMAN_CONFIG":"{}"}');
    process.env.BITWARDEN_ACCESS_TOKEN = "changed-after-startup";
    await loadRunConfig();
    expect(execFile).toHaveBeenCalledWith(
      process.execPath,
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          BITWARDEN_ACCESS_TOKEN: "machine-token",
        }),
      }),
      expect.any(Function),
    );
    expect(process.env.BITWARDEN_ACCESS_TOKEN).toBe("changed-after-startup");
  });

  it.each([
    "provider",
    "validation",
    "config-json",
    "cli-json",
    "missing",
    "non-string",
    "unknown-provider",
    "synchronous-launch",
  ] as const)("fails safely on %s without stale fallback", async (failure) => {
    const { execFile } = await import("node:child_process");
    if (failure === "provider") {
      complete(
        '{"MONEYMAN_CONFIG":"{}"}',
        new Error("sensitive-provider-error"),
        "sensitive-provider-stderr",
      );
    } else if (failure === "synchronous-launch") {
      jest.mocked(execFile).mockImplementationOnce(() => {
        throw new Error("sensitive-launch-error");
      });
    } else if (failure === "unknown-provider") {
      process.env.MONEYMAN_CONFIG_SECRET_PROVIDER = "unsupported";
    } else {
      const values = {
        validation: '{"accounts":[{"password":""}]}',
        "config-json": "invalid-sensitive",
        missing: undefined,
        "non-string": {},
      };
      complete(
        failure === "cli-json"
          ? "invalid-cli-sensitive"
          : JSON.stringify({
              MONEYMAN_CONFIG: values[failure as keyof typeof values],
            }),
      );
    }
    const { loadRunConfig, SECRET_REFRESH_FAILURE } =
      await import("./configRefresh.js");
    await expect(loadRunConfig()).rejects.toEqual(
      new Error(SECRET_REFRESH_FAILURE),
    );
    expect(mockPrivateLog).toHaveBeenCalled();
  });

  it("consumes the installed CLI's actual sensitive JSON output using an offline synthetic schema", async () => {
    const actualExecFile =
      jest.requireActual<typeof import("node:child_process")>(
        "node:child_process",
      ).execFile;
    const execute = promisify(actualExecFile);
    const directory = await mkdtemp(
      path.join(process.cwd(), ".config-refresh-cli-test-"),
    );
    try {
      const schema = path.join(directory, ".env.schema");
      const secret = JSON.stringify(remoteConfig("synthetic-sensitive-bank"));
      await writeFile(
        schema,
        `# @required @sensitive\nMONEYMAN_CONFIG='${secret}'\n`,
      );
      const { stdout } = await execute(
        process.execPath,
        [
          path.resolve("node_modules", "varlock", "bin", "cli.js"),
          "load",
          "--format",
          "json",
          "--filter",
          "MONEYMAN_CONFIG",
          "--path",
          schema,
          "--skip-cache",
        ],
        {
          cwd: directory,
          env: {
            ...workerEnvironment(originalEnv),
            VARLOCK_TELEMETRY_DISABLED: "1",
          },
          encoding: "utf8",
        },
      );
      expect(JSON.parse(stdout)).toEqual({ MONEYMAN_CONFIG: secret });
      const { execFile } = await import("node:child_process");
      complete(stdout);
      const { loadRunConfig } = await import("./configRefresh.js");
      const result = await loadRunConfig();
      expect(result.accounts[0].password).toBe("synthetic-sensitive-bank");
      expect(result.storage.webPost?.authorizationToken).toBe(
        "synthetic-sensitive-bank",
      );
      expect(execFile).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
