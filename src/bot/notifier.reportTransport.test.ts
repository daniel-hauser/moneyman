import { mock } from "jest-mock-extended";
import { createBot } from "./bot.js";

jest.mock("../config.js", () => ({
  config: {
    options: {
      notifications: {
        telegram: {
          apiKey: "test-api-key",
          chatId: "555",
          sendReportFileToTelegram: false,
        },
      },
      scraping: {},
    },
  },
}));
jest.mock("./bot.js", () => ({ createBot: jest.fn() }));

it("omits sendFile from the report transport when disabled", async () => {
  jest.mocked(createBot).mockReturnValue(mock<ReturnType<typeof createBot>>());

  const notifier = await import("./notifier.js");
  expect(notifier.reportTransport).toBeDefined();
  expect(notifier.reportTransport?.sendFile).toBeUndefined();
  expect(notifier.reportTransport?.send).toBeDefined();
  expect(notifier.reportTransport?.edit).toBeDefined();
});
