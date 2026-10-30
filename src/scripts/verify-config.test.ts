jest.mock("dotenv/config", () => ({}));
jest.mock("../configSecret.js", () => ({ loadConfigSecretSync: jest.fn() }));
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
      MONEYMAN_CONFIG_SECRET: "provider-descriptor",
      MONEYMAN_CONFIG: "invalid-legacy-json",
      MONEYMAN_CONFIG_PATH: "must-not-read.json",
    };
    const { loadConfigSecretSync } = await import("../configSecret.js");
    const { readFileSync } = await import("node:fs");
    await import("./verify-config.js");
    expect(loadConfigSecretSync).toHaveBeenCalledWith("provider-descriptor");
    expect(readFileSync).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("fails verification on provider failure without falling back", async () => {
    process.env = {
      MONEYMAN_CONFIG_SECRET: "provider-descriptor",
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
