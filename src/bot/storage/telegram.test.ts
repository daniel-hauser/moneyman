import { TelegramStorage } from "./telegram.js";
import { config } from "../../utils/tests.js";
import type { MoneymanConfig } from "../../config.js";
import { NotificationOptionsSchema } from "../../config.schema.js";

// Mock logger
jest.mock("../../utils/logger.js", () => ({
  createLogger: () => jest.fn(),
  logToPublicLog: jest.fn(),
}));

// Mock notifier
jest.mock("../notifier.js", () => ({
  sendJSON: jest.fn(),
}));

// Mock saveStats
jest.mock("../saveStats.js", () => ({
  createSaveStats: jest.fn().mockReturnValue({
    existing: 0,
    added: 0,
    highlightedTransactions: { Added: [] },
  }),
}));

describe("TelegramStorage", () => {
  describe("canSave", () => {
    it("should return false when telegram notifications are not configured", () => {
      const mockConfig: MoneymanConfig = config();
      mockConfig.options.notifications = {};

      const storage = new TelegramStorage(mockConfig);
      expect(storage.canSave()).toBe(false);
    });

    it("should return true when telegram notifications are configured and storage.telegram is not set (backward compatibility)", () => {
      const mockConfig: MoneymanConfig = config();
      mockConfig.options.notifications = NotificationOptionsSchema.parse({
        telegram: {
          apiKey: "test-key",
          chatId: "test-chat-id",
        },
      });

      const storage = new TelegramStorage(mockConfig);
      expect(storage.canSave()).toBe(true);
    });

    it("should return true when telegram notifications are configured and storage.telegram.enabled is true", () => {
      const mockConfig: MoneymanConfig = config();
      mockConfig.options.notifications = NotificationOptionsSchema.parse({
        telegram: {
          apiKey: "test-key",
          chatId: "test-chat-id",
        },
      });
      mockConfig.storage.telegram = { enabled: true };

      const storage = new TelegramStorage(mockConfig);
      expect(storage.canSave()).toBe(true);
    });

    it("should return false when telegram notifications are configured but storage.telegram.enabled is false", () => {
      const mockConfig: MoneymanConfig = config();
      mockConfig.options.notifications = NotificationOptionsSchema.parse({
        telegram: {
          apiKey: "test-key",
          chatId: "test-chat-id",
        },
      });
      mockConfig.storage.telegram = { enabled: false };

      const storage = new TelegramStorage(mockConfig);
      expect(storage.canSave()).toBe(false);
    });

    it("should return false when storage.telegram.enabled is true but telegram notifications are not configured", () => {
      const mockConfig: MoneymanConfig = config();
      mockConfig.options.notifications = {};
      mockConfig.storage.telegram = { enabled: true };

      const storage = new TelegramStorage(mockConfig);
      expect(storage.canSave()).toBe(false);
    });
  });
});
