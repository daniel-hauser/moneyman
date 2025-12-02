import { TelegramStorage } from "./telegram.js";
import { config } from "../../utils/tests.js";
import type { MoneymanConfig } from "../../config.js";

// Mock logger
jest.mock("../../utils/logger.js", () => ({
  createLogger: () => jest.fn(),
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
      mockConfig.options.notifications.telegram = {
        apiKey: "test-key",
        chatId: "test-chat-id",
        enableOtp: false,
        otpTimeoutSeconds: 300,
        reportRunMetadata: false,
        reportUsedDomains: false,
        reportExternalIp: false,
      };

      const storage = new TelegramStorage(mockConfig);
      expect(storage.canSave()).toBe(true);
    });

    it("should return true when telegram notifications are configured and storage.telegram.enabled is true", () => {
      const mockConfig: MoneymanConfig = config();
      mockConfig.options.notifications.telegram = {
        apiKey: "test-key",
        chatId: "test-chat-id",
        enableOtp: false,
        otpTimeoutSeconds: 300,
        reportRunMetadata: false,
        reportUsedDomains: false,
        reportExternalIp: false,
      };
      mockConfig.storage.telegram = { enabled: true };

      const storage = new TelegramStorage(mockConfig);
      expect(storage.canSave()).toBe(true);
    });

    it("should return false when telegram notifications are configured but storage.telegram.enabled is false", () => {
      const mockConfig: MoneymanConfig = config();
      mockConfig.options.notifications.telegram = {
        apiKey: "test-key",
        chatId: "test-chat-id",
        enableOtp: false,
        otpTimeoutSeconds: 300,
        reportRunMetadata: false,
        reportUsedDomains: false,
        reportExternalIp: false,
      };
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
