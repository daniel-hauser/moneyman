import { parseStorageConfig } from "./storage.parser.ts";

// Save original process.env
const originalEnv = process.env;

describe("Storage Parser", () => {
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
        key === "MONEYMAN_CONFIG"
      ) {
        delete process.env[key];
      }
    });
  });

  afterAll(() => {
    // Restore original process.env after all tests
    process.env = originalEnv;
  });

  describe("Specialized storage parsers", () => {
    it("should parse BuxferConfig from environment variables", () => {
      process.env.BUXFER_USER_NAME = "username";
      process.env.BUXFER_PASSWORD = "password";
      process.env.BUXFER_ACCOUNTS = JSON.stringify({ "1234": "account-id" });

      const config = parseStorageConfig();
      expect(config.buxfer).toEqual({
        username: "username",
        password: "password",
        accounts: { "1234": "account-id" },
      });
    });

    it("should parse AzureDataExplorerConfig from environment variables", () => {
      process.env.AZURE_APP_ID = "app-id";
      process.env.AZURE_APP_KEY = "app-key";
      process.env.AZURE_TENANT_ID = "tenant-id";
      process.env.ADE_DATABASE_NAME = "database-name";
      process.env.ADE_TABLE_NAME = "table-name";
      process.env.ADE_INGESTION_MAPPING = "mapping-name";
      process.env.ADE_INGEST_URI = "https://ingest.example.com";

      const config = parseStorageConfig();
      expect(config.azureDataExplorer).toEqual({
        appId: "app-id",
        appKey: "app-key",
        tenantId: "tenant-id",
        databaseName: "database-name",
        tableName: "table-name",
        ingestionMapping: "mapping-name",
        ingestUri: "https://ingest.example.com",
      });
    });

    it("should parse custom Google Sheets worksheet name", () => {
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "service@example.com";
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = "private-key";
      process.env.GOOGLE_SHEET_ID = "sheet-id";
      process.env.GOOGLE_WORKSHEET_NAME = "custom-worksheet";

      const config = parseStorageConfig();
      expect(config.googleSheets).toEqual({
        serviceAccountEmail: "service@example.com",
        serviceAccountPrivateKey: "private-key",
        sheetId: "sheet-id",
        worksheetName: "custom-worksheet",
      });
    });
  });

  describe("Combined storage options", () => {
    it("should parse multiple storage configurations simultaneously", () => {
      // Set up several storage options at once
      process.env.LOCAL_JSON_STORAGE = "1";
      process.env.WEB_POST_URL = "https://example.com/api";
      process.env.WEB_POST_AUTHORIZATION_TOKEN = "Bearer token123";

      process.env.BUXFER_USER_NAME = "username";
      process.env.BUXFER_PASSWORD = "password";
      process.env.BUXFER_ACCOUNTS = JSON.stringify({ "1234": "account-id" });

      process.env.TELEGRAM_CHAT_ID = "chat-123";

      const config = parseStorageConfig();

      // Each storage option should be correctly parsed
      expect(config.localJson).toEqual({ enabled: true });

      expect(config.webPost).toEqual({
        url: "https://example.com/api",
        authorizationToken: "Bearer token123",
      });

      expect(config.buxfer).toEqual({
        username: "username",
        password: "password",
        accounts: { "1234": "account-id" },
      });

      expect(config.telegram).toEqual({
        chatId: "chat-123",
      });
    });
  });
});
