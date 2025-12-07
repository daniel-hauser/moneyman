// jest.setup.ts

const originalEnv = process.env;

const defaultConfig = {
  accounts: [{ companyId: "test", password: "pass" }],
  storage: { localJson: { enabled: true } },
  options: {
    scraping: {},
    security: {},
    notifications: {
      telegram: {
        apiKey: "test-key",
        chatId: "test-chat-id",
        reportRunMetadata: false,
      },
    },
    logging: {},
  },
};
