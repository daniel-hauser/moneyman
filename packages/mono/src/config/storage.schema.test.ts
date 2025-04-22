import {
  StorageConfig,
  LocalJsonConfig,
  GoogleSheetsConfig,
  YnabConfig,
  BuxferConfig,
  WebPostConfig,
  AzureDataExplorerConfig,
  TelegramStorageConfig,
} from "./storage.schema.ts";

describe("Storage Schema", () => {
  describe("LocalJsonConfig", () => {
    it("should validate with default values", () => {
      const result = LocalJsonConfig.parse({});
      expect(result).toEqual({
        enabled: true,
      });
    });

    it("should validate with custom values", () => {
      const result = LocalJsonConfig.parse({
        enabled: false,
      });
      expect(result).toEqual({
        enabled: false,
      });
    });
  });

  describe("GoogleSheetsConfig", () => {
    it("should validate with required fields", () => {
      const result = GoogleSheetsConfig.parse({
        sheetId: "sheet-id-123",
        serviceAccountEmail: "service@example.com",
        serviceAccountPrivateKey: "private-key",
      });
      expect(result).toEqual({
        sheetId: "sheet-id-123",
        serviceAccountEmail: "service@example.com",
        serviceAccountPrivateKey: "private-key",
        worksheetName: "_moneyman",
      });
    });

    it("should validate with custom worksheet name", () => {
      const result = GoogleSheetsConfig.parse({
        sheetId: "sheet-id-123",
        serviceAccountEmail: "service@example.com",
        serviceAccountPrivateKey: "private-key",
        worksheetName: "custom-sheet",
      });
      expect(result).toEqual({
        sheetId: "sheet-id-123",
        serviceAccountEmail: "service@example.com",
        serviceAccountPrivateKey: "private-key",
        worksheetName: "custom-sheet",
      });
    });

    it("should throw error when required fields are missing", () => {
      expect(() => {
        GoogleSheetsConfig.parse({});
      }).toThrow();
    });
  });

  describe("YnabConfig", () => {
    it("should validate with required fields", () => {
      const result = YnabConfig.parse({
        token: "token-123",
        budgetId: "budget-id-123",
        accounts: { "123": "acc-123" },
      });
      expect(result).toEqual({
        token: "token-123",
        budgetId: "budget-id-123",
        accounts: { "123": "acc-123" },
      });
    });

    it("should throw error when required fields are missing", () => {
      expect(() => {
        YnabConfig.parse({});
      }).toThrow();
    });
  });

  describe("BuxferConfig", () => {
    it("should validate with required fields", () => {
      const result = BuxferConfig.parse({
        username: "username",
        password: "password",
        accounts: { "123": "acc-123" },
      });
      expect(result).toEqual({
        username: "username",
        password: "password",
        accounts: { "123": "acc-123" },
      });
    });

    it("should throw error when required fields are missing", () => {
      expect(() => {
        BuxferConfig.parse({});
      }).toThrow();
    });
  });

  describe("WebPostConfig", () => {
    it("should validate with required fields", () => {
      const result = WebPostConfig.parse({
        url: "https://example.com",
      });
      expect(result).toEqual({
        url: "https://example.com",
      });
    });

    it("should validate with optional authorization token", () => {
      const result = WebPostConfig.parse({
        url: "https://example.com",
        authorizationToken: "Bearer token123",
      });
      expect(result).toEqual({
        url: "https://example.com",
        authorizationToken: "Bearer token123",
      });
    });

    it("should throw error when required fields are missing", () => {
      expect(() => {
        WebPostConfig.parse({});
      }).toThrow();
    });
  });

  describe("AzureDataExplorerConfig", () => {
    it("should validate with required fields", () => {
      const config = {
        appId: "app-id",
        appKey: "app-key",
        tenantId: "tenant-id",
        databaseName: "database-name",
        tableName: "table-name",
        ingestionMapping: "mapping-name",
        ingestUri: "https://ingest.example.com",
      };
      const result = AzureDataExplorerConfig.parse(config);
      expect(result).toEqual(config);
    });

    it("should throw error when required fields are missing", () => {
      expect(() => {
        AzureDataExplorerConfig.parse({});
      }).toThrow();
    });
  });

  describe("TelegramStorageConfig", () => {
    it("should validate with required fields", () => {
      const result = TelegramStorageConfig.parse({
        chatId: "chat-123",
      });
      expect(result).toEqual({
        chatId: "chat-123",
      });
    });

    it("should throw error when required fields are missing", () => {
      expect(() => {
        TelegramStorageConfig.parse({});
      }).toThrow();
    });
  });

  describe("StorageConfig", () => {
    it("should validate with all storage options", () => {
      const config = {
        localJson: { enabled: true },
        googleSheets: {
          sheetId: "sheet-id-123",
          serviceAccountEmail: "service@example.com",
          serviceAccountPrivateKey: "private-key",
        },
        ynab: {
          token: "token-123",
          budgetId: "budget-id-123",
          accounts: { "123": "acc-123" },
        },
        buxfer: {
          username: "username",
          password: "password",
          accounts: { "123": "acc-123" },
        },
        webPost: {
          url: "https://example.com",
        },
        azureDataExplorer: {
          appId: "app-id",
          appKey: "app-key",
          tenantId: "tenant-id",
          databaseName: "database-name",
          tableName: "table-name",
          ingestionMapping: "mapping-name",
          ingestUri: "https://ingest.example.com",
        },
        telegram: {
          chatId: "chat-123",
        },
      };
      const result = StorageConfig.parse(config);
      expect(result).toEqual({
        localJson: { enabled: true },
        googleSheets: {
          sheetId: "sheet-id-123",
          serviceAccountEmail: "service@example.com",
          serviceAccountPrivateKey: "private-key",
          worksheetName: "_moneyman",
        },
        ynab: {
          token: "token-123",
          budgetId: "budget-id-123",
          accounts: { "123": "acc-123" },
        },
        buxfer: {
          username: "username",
          password: "password",
          accounts: { "123": "acc-123" },
        },
        webPost: {
          url: "https://example.com",
        },
        azureDataExplorer: {
          appId: "app-id",
          appKey: "app-key",
          tenantId: "tenant-id",
          databaseName: "database-name",
          tableName: "table-name",
          ingestionMapping: "mapping-name",
          ingestUri: "https://ingest.example.com",
        },
        telegram: {
          chatId: "chat-123",
        },
      });
    });

    it("should validate with empty object", () => {
      const result = StorageConfig.parse({});
      expect(result).toEqual({});
    });

    it("should validate with partial config", () => {
      const result = StorageConfig.parse({
        localJson: { enabled: true },
        googleSheets: {
          sheetId: "sheet-id-123",
          serviceAccountEmail: "service@example.com",
          serviceAccountPrivateKey: "private-key",
        },
      });
      expect(result).toEqual({
        localJson: { enabled: true },
        googleSheets: {
          sheetId: "sheet-id-123",
          serviceAccountEmail: "service@example.com",
          serviceAccountPrivateKey: "private-key",
          worksheetName: "_moneyman",
        },
      });
    });
  });
});
