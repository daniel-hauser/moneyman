import { jest } from "@jest/globals";

describe("config", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should use environment variables when MONEYMAN_CONFIG is not set", async () => {
    process.env = {
      ...originalEnv,
      DAYS_BACK: "15",
      ACCOUNTS_TO_SCRAPE: "test1,test2",
      TELEGRAM_API_KEY: "test-key",
      TELEGRAM_CHAT_ID: "test-chat-id",
    };

    const { config } = await import("./config.js");

    expect(config.DAYS_BACK).toBe("15");
    expect(config.ACCOUNTS_TO_SCRAPE).toBe("test1,test2");
    expect(config.TELEGRAM_API_KEY).toBe("test-key");
    expect(config.TELEGRAM_CHAT_ID).toBe("test-chat-id");
  });

  it("should use MONEYMAN_CONFIG when provided", async () => {
    const configJson = {
      DAYS_BACK: "20",
      ACCOUNTS_TO_SCRAPE: "config1,config2",
      TELEGRAM_API_KEY: "config-key",
      TELEGRAM_CHAT_ID: "config-chat-id",
    };

    process.env = {
      ...originalEnv,
      MONEYMAN_CONFIG: JSON.stringify(configJson),
      // These should be ignored when MONEYMAN_CONFIG is set
      DAYS_BACK: "30",
      ACCOUNTS_TO_SCRAPE: "env1,env2",
    };

    const { config } = await import("./config.js");

    expect(config.DAYS_BACK).toBe("20");
    expect(config.ACCOUNTS_TO_SCRAPE).toBe("config1,config2");
    expect(config.TELEGRAM_API_KEY).toBe("config-key");
    expect(config.TELEGRAM_CHAT_ID).toBe("config-chat-id");
  });

  it("should fall back to env vars when MONEYMAN_CONFIG is invalid JSON", async () => {
    process.env = {
      ...originalEnv,
      MONEYMAN_CONFIG: "invalid json {",
      DAYS_BACK: "25",
      ACCOUNTS_TO_SCRAPE: "fallback1,fallback2",
    };

    const { config } = await import("./config.js");

    expect(config.DAYS_BACK).toBe("25");
    expect(config.ACCOUNTS_TO_SCRAPE).toBe("fallback1,fallback2");
  });

  it("should use default values when neither config nor env vars are provided", async () => {
    process.env = { ...originalEnv };
    delete process.env.DAYS_BACK;
    delete process.env.ACCOUNTS_TO_SCRAPE;

    const { config } = await import("./config.js");

    expect(config.DAYS_BACK).toBe("10"); // default value
    expect(config.ACCOUNTS_TO_SCRAPE).toBe(""); // default value
  });

  it("should validate config with zod schema", async () => {
    // This should pass validation
    const validConfig = {
      DAYS_BACK: "15",
      ACCOUNTS_TO_SCRAPE: "test",
      TELEGRAM_API_KEY: "key",
    };

    process.env = {
      ...originalEnv,
      MONEYMAN_CONFIG: JSON.stringify(validConfig),
    };

    const { config } = await import("./config.js");
    expect(config.DAYS_BACK).toBe("15");
  });
});
