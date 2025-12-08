import { jest } from "@jest/globals";
import { mock } from "jest-mock-extended";
import type { Telegraf } from "telegraf";
import { MoneymanConfigSchema } from "./config.schema.js";

jest.mock("dotenv/config", () => ({}));
jest.mock("telegraf", () => ({ Telegraf: mock<Telegraf>() }));

describe("config", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should parse empty config using defaults", () => {
    const parsed = MoneymanConfigSchema.parse({});

    expect(parsed.accounts).toEqual([]);
    expect(parsed.storage.localJson?.enabled).toBe(true);
    expect(parsed.options.scraping.daysBack).toBe(10);
    expect(parsed.options.logging.getIpInfoUrl).toBe("https://ipinfo.io/json");
  });

  it("should use MONEYMAN_CONFIG when provided", async () => {
    const configJson = {
      accounts: [{ companyId: "test", password: "pass", userCode: "12345" }],
      storage: { localJson: { enabled: true } },
      options: {
        scraping: {
          daysBack: 20,
          accountsToScrape: ["config1", "config2"],
        },
        security: {},
        notifications: {
          telegram: {
            apiKey: "config-key",
            chatId: "config-chat-id",
          },
        },
        logging: {},
      },
    };

    process.env = {
      ...originalEnv,
      MONEYMAN_CONFIG_PATH: undefined,
      MONEYMAN_CONFIG: JSON.stringify(configJson),
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

  it("should validate config with zod schema", async () => {
    // This should pass validation
    const validConfig = {
      accounts: [{ companyId: "test", password: "pass", userCode: "12345" }],
      storage: { localJson: { enabled: true } },
      options: {
        scraping: {
          daysBack: 15,
          accountsToScrape: ["test"],
        },
        security: {},
        notifications: {
          telegram: {
            apiKey: "key",
            chatId: "123",
          },
        },
        logging: {},
      },
    };

    process.env = {
      ...originalEnv,
      MONEYMAN_CONFIG_PATH: undefined,
      MONEYMAN_CONFIG: JSON.stringify(validConfig),
    };

    const { config } = await import("./config.js");
    expect(config.options.scraping.daysBack).toBe(15);
  });

  const internalUrls = [
    "http://actual-budget:5006",
    "https://actual-budget:5006",
    "http://localhost:3000",
    "https://my-server.local:8080",
    "http://192.168.1.100:9000",
    "https://localhost",
  ];

  const baseOptions = {
    scraping: {},
    security: {},
    notifications: {},
    logging: {},
  };

  it.each(internalUrls)(
    "should support internal URL %s for actual.serverUrl",
    async (url) => {
      const configWithUrl = {
        accounts: [{ companyId: "test", password: "pass", userCode: "12345" }],
        storage: {
          actual: {
            serverUrl: url,
            password: "test-password",
            budgetId: "test-budget-id",
            accounts: {},
          },
        },
        options: baseOptions,
      };

      process.env = {
        ...originalEnv,
        MONEYMAN_CONFIG_PATH: undefined,
        MONEYMAN_CONFIG: JSON.stringify(configWithUrl),
      };

      const { config } = await import("./config.js");
      expect(config.storage.actual?.serverUrl).toBe(url);
    },
  );

  it.each(internalUrls)(
    "should support internal URL %s for webPost.url",
    async (url) => {
      const configWithUrl = {
        accounts: [{ companyId: "test", password: "pass", userCode: "12345" }],
        storage: {
          webPost: {
            url: url,
            authorizationToken: "test-token",
          },
        },
        options: baseOptions,
      };

      process.env = {
        ...originalEnv,
        MONEYMAN_CONFIG_PATH: undefined,
        MONEYMAN_CONFIG: JSON.stringify(configWithUrl),
      };

      const { config } = await import("./config.js");
      expect(config.storage.webPost?.url).toBe(url);
    },
  );

  it("should use MONEYMAN_CONFIG_PATH when provided and MONEYMAN_CONFIG is not set", async () => {
    const configJson = {
      accounts: [{ companyId: "test", password: "pass", userCode: "12345" }],
      storage: { localJson: { enabled: true } },
      options: {
        scraping: {
          daysBack: 25,
          futureMonths: 2,
          maxParallelScrapers: 2,
          accountsToScrape: ["path1", "path2"],
        },
        security: { blockByDefault: true },
        notifications: {
          telegram: {
            apiKey: "path-key",
            chatId: "path-chat-id",
          },
        },
        logging: {},
      },
    };

    // Create a temporary config file
    const { mkdtempSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const tempDir = mkdtempSync(join(tmpdir(), "moneyman-test-"));
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify(configJson, null, 2));

    process.env = {
      ...originalEnv,
      MONEYMAN_CONFIG_PATH: configPath,
    };
    delete process.env.MONEYMAN_CONFIG;

    const { config } = await import("./config.js");

    expect(config.options.scraping.daysBack).toBe(25);
    expect(config.options.scraping.accountsToScrape).toEqual([
      "path1",
      "path2",
    ]);
    expect(config.options.scraping.maxParallelScrapers).toBe(2);
    expect(config.options.notifications.telegram?.apiKey).toBe("path-key");
    expect(config.options.notifications.telegram?.chatId).toBe("path-chat-id");
    expect(config.options.security.blockByDefault).toBe(true);

    // Cleanup
    const { unlinkSync, rmdirSync } = await import("fs");
    unlinkSync(configPath);
    rmdirSync(tempDir);
  });

  it("should prioritize MONEYMAN_CONFIG over MONEYMAN_CONFIG_PATH", async () => {
    const configJsonFromEnv = {
      accounts: [{ companyId: "test", password: "pass", userCode: "12345" }],
      storage: { localJson: { enabled: true } },
      options: {
        scraping: {
          daysBack: 30,
          accountsToScrape: ["env1"],
        },
        security: {},
        notifications: {
          telegram: {
            apiKey: "env-key",
            chatId: "env-chat-id",
          },
        },
        logging: {},
      },
    };

    const configJsonFromFile = {
      accounts: [{ companyId: "test", password: "pass", userCode: "12345" }],
      storage: { localJson: { enabled: true } },
      options: {
        scraping: {
          daysBack: 50,
          accountsToScrape: ["file1"],
        },
        security: {},
        notifications: {},
        logging: {},
      },
    };

    // Create a temporary config file
    const { mkdtempSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const tempDir = mkdtempSync(join(tmpdir(), "moneyman-test-"));
    const configPath = join(tempDir, "config.json");
    writeFileSync(configPath, JSON.stringify(configJsonFromFile, null, 2));

    process.env = {
      ...originalEnv,
      MONEYMAN_CONFIG: JSON.stringify(configJsonFromEnv),
      MONEYMAN_CONFIG_PATH: configPath,
    };

    const { config } = await import("./config.js");

    // Should use MONEYMAN_CONFIG, not MONEYMAN_CONFIG_PATH
    expect(config.options.scraping.daysBack).toBe(30);
    expect(config.options.scraping.accountsToScrape).toEqual(["env1"]);
    expect(config.options.notifications.telegram?.apiKey).toBe("env-key");

    // Cleanup
    const { unlinkSync, rmdirSync } = await import("fs");
    unlinkSync(configPath);
    rmdirSync(tempDir);
  });

  it("should support JSONC (JSON with comments) in config file", async () => {
    const configJsonc = `{
      // This is a comment
      "accounts": [
        { "companyId": "test", "password": "pass", "userCode": "12345" }
      ],
      "storage": {
        "localJson": { "enabled": true }
      },
      "options": {
        "scraping": {
          "daysBack": 35 // days to look back
        },
        "security": {},
        "notifications": {},
        "logging": {}
      }
    }`;

    // Create a temporary config file
    const { mkdtempSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");
    const tempDir = mkdtempSync(join(tmpdir(), "moneyman-test-"));
    const configPath = join(tempDir, "config.jsonc");
    writeFileSync(configPath, configJsonc);

    process.env = {
      ...originalEnv,
      MONEYMAN_CONFIG: "",
      MONEYMAN_CONFIG_PATH: configPath,
    };

    const { config } = await import("./config.js");

    expect(config.options.scraping.daysBack).toBe(35);
    expect(config.accounts).toHaveLength(1);

    // Cleanup
    const { unlinkSync, rmdirSync } = await import("fs");
    unlinkSync(configPath);
    rmdirSync(tempDir);
  });
});
