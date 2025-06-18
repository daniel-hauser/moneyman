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
      ACCOUNTS_JSON: JSON.stringify([
        { companyId: "test", password: "pass", userCode: "12345" },
      ]),
      LOCAL_JSON_STORAGE: "true",
    };

    const { config } = await import("./config.js");

    expect(config.options.scraping.daysBack).toBe(15);
    expect(config.options.scraping.accountsToScrape).toEqual([
      "test1",
      "test2",
    ]);
    expect(config.options.notifications.telegram?.apiKey).toBe("test-key");
    expect(config.options.notifications.telegram?.chatId).toBe("test-chat-id");
  });

  it("should use MONEYMAN_CONFIG when provided", async () => {
    const configJson = {
      accounts: [{ companyId: "test", password: "pass", userCode: "12345" }],
      storage: { localJson: { enabled: true } },
      options: {
        scraping: {
          daysBack: 20,
          futureMonths: 1,
          timezone: "Asia/Jerusalem",
          transactionHashType: "",
          additionalTransactionInfo: false,
          hiddenDeprecations: [],
          maxParallelScrapers: 1,
          domainTracking: false,
          accountsToScrape: ["config1", "config2"],
        },
        security: {
          blockByDefault: false,
        },
        notifications: {
          telegram: {
            apiKey: "config-key",
            chatId: "config-chat-id",
          },
        },
        logging: {
          debug: "",
          separatedMode: true,
          timezone: "Asia/Jerusalem",
          getIpInfoUrl: "https://ipinfo.io/json",
        },
      },
    };

    process.env = {
      ...originalEnv,
      MONEYMAN_CONFIG: JSON.stringify(configJson),
      // These should be ignored when MONEYMAN_CONFIG is set
      DAYS_BACK: "30",
      ACCOUNTS_TO_SCRAPE: "env1,env2",
    };

    const { config } = await import("./config.js");

    expect(config.options.scraping.daysBack).toBe(20);
    expect(config.options.scraping.accountsToScrape).toEqual([
      "config1",
      "config2",
    ]);
    expect(config.options.notifications.telegram?.apiKey).toBe("config-key");
    expect(config.options.notifications.telegram?.chatId).toBe(
      "config-chat-id",
    );
  });

  it("should fall back to env vars when MONEYMAN_CONFIG is invalid JSON", async () => {
    process.env = {
      ...originalEnv,
      MONEYMAN_CONFIG: "invalid json {",
      DAYS_BACK: "25",
      ACCOUNTS_TO_SCRAPE: "fallback1,fallback2",
      ACCOUNTS_JSON: JSON.stringify([
        { companyId: "test", password: "pass", userCode: "12345" },
      ]),
      LOCAL_JSON_STORAGE: "true",
    };

    const { config } = await import("./config.js");

    expect(config.options.scraping.daysBack).toBe(25);
    expect(config.options.scraping.accountsToScrape).toEqual([
      "fallback1",
      "fallback2",
    ]);
  });

  it("should use default values when neither config nor env vars are provided", async () => {
    process.env = {
      ...originalEnv,
      ACCOUNTS_JSON: JSON.stringify([
        { companyId: "test", password: "pass", userCode: "12345" },
      ]),
      LOCAL_JSON_STORAGE: "true",
    };
    delete process.env.DAYS_BACK;
    delete process.env.ACCOUNTS_TO_SCRAPE;

    const { config } = await import("./config.js");

    expect(config.options.scraping.daysBack).toBe(10); // default value
    expect(config.options.scraping.accountsToScrape).toBeUndefined(); // default value
  });

  it("should validate config with zod schema", async () => {
    // This should pass validation
    const validConfig = {
      accounts: [{ companyId: "test", password: "pass", userCode: "12345" }],
      storage: { localJson: { enabled: true } },
      options: {
        scraping: {
          daysBack: 15,
          futureMonths: 1,
          timezone: "Asia/Jerusalem",
          transactionHashType: "",
          additionalTransactionInfo: false,
          hiddenDeprecations: [],
          maxParallelScrapers: 1,
          domainTracking: false,
          accountsToScrape: ["test"],
        },
        security: {
          blockByDefault: false,
        },
        notifications: {
          telegram: {
            apiKey: "key",
            chatId: "123",
          },
        },
        logging: {
          debug: "",
          separatedMode: true,
          timezone: "Asia/Jerusalem",
          getIpInfoUrl: "https://ipinfo.io/json",
        },
      },
    };

    process.env = {
      ...originalEnv,
      MONEYMAN_CONFIG: JSON.stringify(validConfig),
    };

    const { config } = await import("./config.js");
    expect(config.options.scraping.daysBack).toBe(15);
  });
});
