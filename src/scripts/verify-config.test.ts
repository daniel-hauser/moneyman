jest.mock("dotenv/config", () => ({}));
jest.mock("../configSecret.js", () => ({
  ...jest.requireActual("../configSecret.js"),
  loadConfigSecretSync: jest.fn(),
}));
jest.mock("node:fs", () => ({
  ...jest.requireActual("node:fs"),
  readFileSync: jest.fn(),
}));

describe("configuration verification entrypoint", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {};
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("uses the shared startup loader when a provider overrides legacy sources", async () => {
    process.env = {
      MONEYMAN_CONFIG_SECRET: '{"provider":"bitwarden"}',
      MONEYMAN_CONFIG: "invalid-legacy-json",
      MONEYMAN_CONFIG_PATH: "must-not-read.json",
    };
    const { loadConfigSecretSync } = await import("../configSecret.js");
    const { readFileSync } = await import("node:fs");
    await import("./verify-config.js");
    expect(loadConfigSecretSync).toHaveBeenCalledWith(
      '{"provider":"bitwarden"}',
    );
    expect(readFileSync).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("fails verification on provider failure without falling back", async () => {
    process.env = {
      MONEYMAN_CONFIG_SECRET: '{"provider":"bitwarden"}',
      MONEYMAN_CONFIG: "{}",
      MONEYMAN_CONFIG_PATH: "must-not-read.json",
    };
    const { loadConfigSecretSync } = await import("../configSecret.js");
    const { readFileSync } = await import("node:fs");
    jest.mocked(loadConfigSecretSync).mockImplementationOnce(() => {
      throw new Error("safe startup failure");
    });
    await import("./verify-config.js");
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("loads the provider descriptor directly from a file before legacy sources", async () => {
    process.env = {
      MONEYMAN_CONFIG_SECRET: "/run/secrets/moneyman_provider",
      MONEYMAN_CONFIG: "invalid-legacy-json",
      MONEYMAN_CONFIG_PATH: "must-not-read.json",
    };
    const { loadConfigSecretSync } = await import("../configSecret.js");
    const { readFileSync } = await import("node:fs");
    jest.mocked(readFileSync).mockReturnValueOnce("file-provider-descriptor");
    await import("./verify-config.js");
    expect(loadConfigSecretSync).toHaveBeenCalledWith(
      "file-provider-descriptor",
    );
    expect(readFileSync).toHaveBeenCalledTimes(1);
    expect(readFileSync).toHaveBeenCalledWith(
      "/run/secrets/moneyman_provider",
      "utf8",
    );
    expect(process.env.MONEYMAN_CONFIG_SECRET).toBe(
      "/run/secrets/moneyman_provider",
    );
    expect(process.exit).not.toHaveBeenCalled();
  });

  it.each(["unreadable", "empty"])(
    "fails verification on %s descriptor files without exposing input or falling back",
    async (failure) => {
      process.env = {
        MONEYMAN_CONFIG_SECRET: "invented-sensitive-path",
        MONEYMAN_CONFIG: "{}",
        MONEYMAN_CONFIG_PATH: "must-not-read.json",
      };
      const { loadConfigSecretSync } = await import("../configSecret.js");
      const { readFileSync } = await import("node:fs");
      if (failure === "unreadable") {
        jest.mocked(readFileSync).mockImplementationOnce(() => {
          throw new Error("invented-sensitive-filesystem-error");
        });
      } else {
        jest.mocked(readFileSync).mockReturnValueOnce(" \n");
      }
      await import("./verify-config.js");
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(loadConfigSecretSync).not.toHaveBeenCalled();
      expect(readFileSync).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify(jest.mocked(console.error).mock.calls),
      ).not.toContain("invented-sensitive");
    },
  );

  it("validates a configuration file when no inline config is set", async () => {
    process.env.MONEYMAN_CONFIG_PATH = "config.jsonc";
    const { readFileSync } = await import("node:fs");
    jest
      .mocked(readFileSync)
      .mockReturnValueOnce('{/* JSONC */ "accounts":[]}');
    await import("./verify-config.js");
    expect(readFileSync).toHaveBeenCalledWith("config.jsonc", "utf8");
    expect(process.exit).not.toHaveBeenCalled();
  });

  it.each(["{}", "{ invalid", '{"accounts":[{"password":""}]}'])(
    "validates inline config %s before considering a file",
    async (value) => {
      process.env = {
        MONEYMAN_CONFIG: value,
        MONEYMAN_CONFIG_PATH: "must-not-read.json",
      };
      const { readFileSync } = await import("node:fs");
      await import("./verify-config.js");
      expect(readFileSync).not.toHaveBeenCalled();
      if (value === "{}") expect(process.exit).not.toHaveBeenCalled();
      else expect(process.exit).toHaveBeenCalledWith(1);
    },
  );
});
