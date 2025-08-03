import { jest } from "@jest/globals";

describe("notifier", () => {
  describe("OTP validation regex", () => {
    it("should validate correct OTP formats", () => {
      const otpRegex = /^\d{4,8}$/;
      
      // Valid OTP codes
      expect("1234").toMatch(otpRegex);
      expect("123456").toMatch(otpRegex);
      expect("12345678").toMatch(otpRegex);
      
      // Invalid OTP codes
      expect("123").not.toMatch(otpRegex); // too short
      expect("123456789").not.toMatch(otpRegex); // too long
      expect("12a456").not.toMatch(otpRegex); // contains letters
      expect("12-456").not.toMatch(otpRegex); // contains dash
      expect("").not.toMatch(otpRegex); // empty
    });
  });

  describe("requestOtpCode function", () => {
    it("should exist and be a function", async () => {
      // Mock the dependencies to avoid module loading issues
      jest.doMock("../config.js", () => ({
        config: {
          options: {
            notifications: {
              telegram: {
                apiKey: "test-api-key",
                chatId: "test-chat-id",
                enableOtp: true,
                otpTimeoutSeconds: 300,
              },
            },
            scraping: {
              hiddenDeprecations: [],
            },
          },
        },
      }));

      jest.doMock("../utils/logger.js", () => ({
        createLogger: () => jest.fn(),
        logToPublicLog: jest.fn(),
      }));

      jest.doMock("telegraf", () => ({
        Telegraf: jest.fn(() => ({
          telegram: {
            sendMessage: jest.fn(),
          },
          on: jest.fn(),
          launch: jest.fn(),
        })),
        TelegramError: Error,
      }));

      const notifierModule = await import("./notifier.js");
      
      // Verify the function exists and is callable
      expect(typeof notifierModule.requestOtpCode).toBe("function");
      
      jest.dontMock("../config.js");
      jest.dontMock("../utils/logger.js");
      jest.dontMock("telegraf");
    });
  });
});