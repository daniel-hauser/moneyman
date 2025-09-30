import { jest } from "@jest/globals";

describe("notifier", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.resetAllMocks();
    jest.clearAllMocks();

    // Mock dependencies
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
  });

  afterEach(() => {
    // Clean up mocks after each test
    jest.dontMock("../config.js");
    jest.dontMock("../utils/logger.js");
    jest.dontMock("telegraf");
  });

  describe("requestOtpCode function", () => {
    it("should exist and be a function", async () => {
      const notifierModule = await import("./notifier.js");

      // Verify the function exists and is callable
      expect(typeof notifierModule.requestOtpCode).toBe("function");
    });
  });
});
