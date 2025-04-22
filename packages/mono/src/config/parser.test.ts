import { parseConfig } from "./parser.ts";

// Save original process.env
const originalEnv = process.env;

describe("Config Parser", () => {
  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
    // Clear all config-related env vars to ensure clean tests
    Object.keys(process.env).forEach((key) => {
      if (
        key.startsWith("LOCAL_JSON_") ||
        key.startsWith("GOOGLE_") ||
        key.startsWith("YNAB_") ||
        key.startsWith("BUXFER_") ||
        key.startsWith("WEB_POST_") ||
        key.startsWith("AZURE_") ||
        key.startsWith("ADE_") ||
        key.startsWith("TELEGRAM_") ||
        key === "MONEYMAN_CONFIG" ||
        key === "ACCOUNTS_JSON" ||
        key === "ACCOUNTS_TO_SCRAPE" ||
        key === "DAYS_BACK" ||
        key === "FUTURE_MONTHS" ||
        key === "MAX_PARALLEL_SCRAPERS" ||
        key === "TRANSACTION_HASH_TYPE" ||
        key === "DOMAIN_TRACKING_ENABLED" ||
        key === "HIDDEN_DEPRECATIONS" ||
        key === "TZ"
      ) {
        delete process.env[key];
      }
    });
  });

  afterAll(() => {
    // Restore original process.env after all tests
    process.env = originalEnv;
  });

  describe("Main config parsing", () => {
    it("should parse a complete config from MONEYMAN_CONFIG", () => {
      const completeConfig = {
        scraper: {
          accounts: [
            { companyId: "hapoalim", userCode: "12345", password: "pass" },
          ],
          accountsToScrape: "",
          daysBack: 15,
          futureMonths: 2,
          timezone: "UTC",
          maxParallelScrapers: 3,
          domainTrackingEnabled: true,
        },
        notifier: {
          telegram: {
            apiKey: "bot-api-key",
            chatId: "chat-123",
          },
        },
        storage: {
          localJson: { enabled: true },
          webPost: {
            url: "https://example.com/api",
          },
        },
      };

      process.env.MONEYMAN_CONFIG = JSON.stringify(completeConfig);

      const config = parseConfig();
      expect(config.scraper).toEqual({
        accounts: [
          { companyId: "hapoalim", userCode: "12345", password: "pass" },
        ],
        accountsToScrape: "",
        daysBack: 15,
        futureMonths: 2,
        timezone: "UTC",
        maxParallelScrapers: 3,
        domainTrackingEnabled: true,
        hiddenDeprecations: [],
        transactionHashType: "",
      });
      expect(config.notifier).toEqual({
        telegram: {
          apiKey: "bot-api-key",
          chatId: "chat-123",
        },
      });
      expect(config.storage).toEqual({
        localJson: { enabled: true },
        webPost: {
          url: "https://example.com/api",
        },
      });
    });

    it("should fall back to legacy env vars if MONEYMAN_CONFIG is invalid JSON", () => {
      process.env.MONEYMAN_CONFIG = "invalid-json";
      process.env.ACCOUNTS_JSON = JSON.stringify([
        { companyId: "hapoalim", userCode: "12345", password: "pass" },
      ]);
      process.env.LOCAL_JSON_STORAGE = "1";
      process.env.TELEGRAM_TOKEN = "bot-token";
      process.env.TELEGRAM_CHAT_ID = "chat-123";

      const config = parseConfig();
      expect(config.scraper.accounts).toEqual([
        { companyId: "hapoalim", userCode: "12345", password: "pass" },
      ]);
      expect(config.storage.localJson).toEqual({ enabled: true });
      expect(config.notifier.telegram).toEqual({
        apiKey: "bot-token",
        chatId: "chat-123",
      });
    });

    it("should prioritize MONEYMAN_CONFIG over legacy environment variables", () => {
      // Set up both new and legacy configs
      process.env.MONEYMAN_CONFIG = JSON.stringify({
        scraper: {
          accounts: [
            { companyId: "hapoalim", userCode: "new", password: "new" },
          ],
          daysBack: 30,
        },
        notifier: {
          telegram: {
            apiKey: "new-token",
            chatId: "new-chat",
          },
        },
        storage: {
          localJson: { enabled: false },
        },
      });

      // These should be ignored because MONEYMAN_CONFIG takes precedence
      process.env.ACCOUNTS_JSON = JSON.stringify([
        { companyId: "legacy", userCode: "legacy", password: "legacy" },
      ]);
      process.env.DAYS_BACK = "5";
      process.env.TELEGRAM_TOKEN = "legacy-token";
      process.env.TELEGRAM_CHAT_ID = "legacy-chat";
      process.env.LOCAL_JSON_STORAGE = "1";

      const config = parseConfig();
      expect(config.scraper.accounts).toEqual([
        { companyId: "hapoalim", userCode: "new", password: "new" },
      ]);
      expect(config.scraper.daysBack).toBe(30);
      expect(config.notifier.telegram).toEqual({
        apiKey: "new-token",
        chatId: "new-chat",
      });
      expect(config.storage.localJson).toEqual({ enabled: false });
    });
  });

  describe("Scraper config", () => {
    it("should parse scraper config with all fields from legacy env vars", () => {
      process.env.ACCOUNTS_JSON = JSON.stringify([
        { companyId: "hapoalim", userCode: "12345", password: "pass" },
        { companyId: "max", username: "user", password: "pass" },
      ]);
      process.env.ACCOUNTS_TO_SCRAPE = "hapoalim,max";
      process.env.DAYS_BACK = "20";
      process.env.FUTURE_MONTHS = "3";
      process.env.MAX_PARALLEL_SCRAPERS = "2";
      process.env.TRANSACTION_HASH_TYPE = "moneyman";
      process.env.DOMAIN_TRACKING_ENABLED = "1";
      process.env.HIDDEN_DEPRECATIONS = "dep1,dep2";
      process.env.TZ = "America/New_York";

      const config = parseConfig();
      expect(config.scraper).toEqual({
        accounts: [
          { companyId: "hapoalim", userCode: "12345", password: "pass" },
          { companyId: "max", username: "user", password: "pass" },
        ],
        accountsToScrape: "hapoalim,max",
        daysBack: 20,
        futureMonths: 3,
        timezone: "America/New_York",
        maxParallelScrapers: 2,
        transactionHashType: "moneyman",
        domainTrackingEnabled: true,
        hiddenDeprecations: ["dep1", "dep2"],
        firewallSettings: undefined,
        puppeteerExecutablePath: undefined,
      });
    });

    it("should use default values for missing scraper configs", () => {
      process.env.ACCOUNTS_JSON = JSON.stringify([
        { companyId: "hapoalim", userCode: "12345", password: "pass" },
      ]);

      const config = parseConfig();
      expect(config.scraper).toEqual(
        expect.objectContaining({
          accounts: [
            { companyId: "hapoalim", userCode: "12345", password: "pass" },
          ],
          accountsToScrape: "",
          daysBack: 10,
          futureMonths: 1,
          maxParallelScrapers: 1,
          domainTrackingEnabled: false,
          hiddenDeprecations: [],
          transactionHashType: "",
        }),
      );
    });
  });

  describe("Notifier config", () => {
    it("should parse notifier config from legacy env vars", () => {
      process.env.ACCOUNTS_JSON = JSON.stringify([]);
      process.env.TELEGRAM_TOKEN = "telegram-token-123";
      process.env.TELEGRAM_CHAT_ID = "telegram-chat-456";

      const config = parseConfig();
      expect(config.notifier).toEqual({
        telegram: {
          apiKey: "telegram-token-123",
          chatId: "telegram-chat-456",
        },
      });
    });

    it("should exclude telegram config when required fields are missing", () => {
      process.env.ACCOUNTS_JSON = JSON.stringify([]);
      process.env.TELEGRAM_TOKEN = "telegram-token-123";
      // Missing TELEGRAM_CHAT_ID

      const config = parseConfig();
      expect(config.notifier).toEqual({});
    });
  });

  describe("Storage config", () => {
    it("should parse individual storage options from legacy env vars", () => {
      process.env.ACCOUNTS_JSON = JSON.stringify([]);
      process.env.LOCAL_JSON_STORAGE = "1";
      process.env.WEB_POST_URL = "https://example.com/api";

      const config = parseConfig();
      expect(config.storage).toEqual({
        localJson: { enabled: true },
        webPost: {
          url: "https://example.com/api",
        },
      });
    });

    it("should correctly parse integrations with multiple required fields", () => {
      process.env.ACCOUNTS_JSON = JSON.stringify([]);
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "service@example.com";
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "private-key";
      process.env.GOOGLE_SHEET_ID = "sheet-id";

      process.env.YNAB_TOKEN = "token";
      process.env.YNAB_BUDGET_ID = "budget-id";
      process.env.YNAB_ACCOUNTS = JSON.stringify({ "1234": "account-id" });

      const config = parseConfig();
      expect(config.storage.googleSheets).toEqual({
        serviceAccountEmail: "service@example.com",
        serviceAccountPrivateKey: "private-key",
        sheetId: "sheet-id",
        worksheetName: "_moneyman",
      });

      expect(config.storage.ynab).toEqual({
        token: "token",
        budgetId: "budget-id",
        accounts: { "1234": "account-id" },
      });
    });

    it("should skip configurations with missing required fields", () => {
      // Missing GOOGLE_SHEET_ID
      process.env.ACCOUNTS_JSON = JSON.stringify([]);
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "service@example.com";
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "private-key";

      // Missing YNAB_ACCOUNTS
      process.env.YNAB_TOKEN = "token";
      process.env.YNAB_BUDGET_ID = "budget-id";

      // This one is complete and should be included
      process.env.LOCAL_JSON_STORAGE = "1";

      const config = parseConfig();
      expect(config.storage).toEqual({
        localJson: { enabled: true },
      });
      expect(config.storage.googleSheets).toBeUndefined();
      expect(config.storage.ynab).toBeUndefined();
    });
  });
});
