import {
  getTelegramBot,
  launchTelegramBot,
  isTelegramBotRunning,
  requestOtpCode,
  stopTelegramBot,
} from "./notifier.js";

jest.mock("../config.js", () => ({
  config: {
    options: {
      notifications: {
        telegram: {
          apiKey: "test-token",
          chatId: "555",
          enableOtp: true,
          otpTimeoutSeconds: 3600,
        },
      },
      scraping: {},
    },
  },
}));

/**
 * The notifier builds its bot when the module is imported, so the class is
 * faked here and the instance is reached through `getTelegramBot()`.
 */
jest.mock("telegraf", () => {
  let nextMessageId = 1;
  class Telegraf {
    polling: { stop: () => void } | undefined = undefined;
    webhookServer: unknown = undefined;
    handlers: Array<(ctx: unknown, next: () => Promise<void>) => unknown> = [];
    telegram = {
      sendMessage: jest.fn(async () => ({ message_id: nextMessageId++ })),
      sendDocument: jest.fn(async () => ({})),
      sendPhoto: jest.fn(async () => ({})),
    };
    on(
      _filter: unknown,
      handler: (ctx: unknown, next: () => Promise<void>) => unknown,
    ) {
      this.handlers.push(handler);
      return this;
    }
    launch(callback?: () => void) {
      this.polling = { stop: jest.fn() };
      callback?.();
      return Promise.resolve();
    }
    stop() {
      if (this.polling === undefined && this.webhookServer === undefined) {
        throw new Error("Bot is not running!");
      }
      this.polling?.stop();
    }
  }
  return { Telegraf };
});

jest.mock("telegraf/filters", () => ({ message: () => "text" }));

type Handler = (ctx: unknown, next: () => Promise<void>) => unknown;

type FakeBot = {
  handlers: Handler[];
  polling: { stop: () => void } | undefined;
  webhookServer: unknown;
  telegram: { sendMessage: jest.Mock };
  launch: (callback?: () => void) => Promise<void>;
  stop: () => void;
};

const bot = () => getTelegramBot() as unknown as FakeBot;

function createContext(text: string, replyToMessageId?: number) {
  return {
    chat: { id: "555" },
    message: {
      text,
      ...(replyToMessageId === undefined
        ? {}
        : { reply_to_message: { message_id: replyToMessageId } }),
    },
    reply: jest.fn().mockResolvedValue(undefined),
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** `pending` when the promise has not settled by the next macrotask */
function settleState(promise: Promise<unknown>) {
  return Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected",
    ),
    flush().then(() => "pending"),
  ]);
}

const sentMessageId = async (index: number) =>
  (await bot().telegram.sendMessage.mock.results[index].value).message_id;

describe("requestOtpCode", () => {
  beforeEach(() => {
    const fakeBot = bot();
    fakeBot.handlers = [];
    fakeBot.polling = undefined;
    fakeBot.webhookServer = undefined;
    stopTelegramBot();
    fakeBot.telegram.sendMessage.mockClear();
  });

  it("hands a reply to the request whose message it targets", async () => {
    const fakeBot = bot();
    const first = requestOtpCode("oneZero", "+97200000001");
    const second = requestOtpCode("oneZero", "+97200000002");
    await flush();

    expect(fakeBot.handlers).toHaveLength(2);
    const [firstHandler, secondHandler] = fakeBot.handlers;
    const next = jest.fn().mockResolvedValue(undefined);
    const firstMessageId = await sentMessageId(0);
    const secondMessageId = await sentMessageId(1);

    // A message that is not a reply is ambiguous while two requests wait
    await firstHandler(createContext("999999"), next);
    await secondHandler(createContext("999999"), next);
    expect(await settleState(first)).toBe("pending");
    expect(await settleState(second)).toBe("pending");

    // The reply to the second request must not be taken by the first one
    await firstHandler(createContext("222222", secondMessageId), next);
    expect(await settleState(first)).toBe("pending");
    await secondHandler(createContext("222222", secondMessageId), next);
    await expect(second).resolves.toBe("222222");
    expect(await settleState(first)).toBe("pending");

    // With a single request left, a plain message is accepted again
    await firstHandler(createContext("111111"), next);
    await expect(first).resolves.toBe("111111");

    // The first message id is only used by its own request
    expect(firstMessageId).not.toBe(secondMessageId);
    expect(isTelegramBotRunning()).toBe(false);
  });

  it("does not stop polling started by the server", async () => {
    await launchTelegramBot();
    const request = requestOtpCode("oneZero", "+97200000001");
    await flush();

    await bot().handlers[0](
      createContext("123456"),
      jest.fn().mockResolvedValue(undefined),
    );

    await expect(request).resolves.toBe("123456");
    expect(isTelegramBotRunning()).toBe(true);
    stopTelegramBot();
  });

  it("rejects the request when polling fails to start", async () => {
    const launch = jest
      .spyOn(bot(), "launch")
      .mockRejectedValueOnce(new Error("polling failed"));
    try {
      await expect(requestOtpCode("oneZero", "+97200000001")).rejects.toThrow(
        "Failed to start Telegram bot for OTP: Error: polling failed",
      );
      expect(isTelegramBotRunning()).toBe(false);
      expect(bot().telegram.sendMessage).toHaveBeenLastCalledWith(
        "555",
        expect.stringContaining("requestOtpCode\n❌ polling failed"),
      );
    } finally {
      launch.mockRestore();
    }
  });
});

describe("stopTelegramBot", () => {
  beforeEach(() => {
    const fakeBot = bot();
    fakeBot.handlers = [];
    fakeBot.polling = undefined;
    fakeBot.webhookServer = undefined;
    stopTelegramBot();
  });

  it("keeps shutting down when Telegraf has nothing to stop yet", async () => {
    const fakeBot = bot();
    await launchTelegramBot();
    expect(fakeBot.polling).toBeDefined();

    // A signal that lands before `launch()` resolved: flagged as running, but
    // polling is not up yet, so Telegraf's `stop()` throws.
    fakeBot.polling = undefined;
    expect(() => fakeBot.stop()).toThrow("Bot is not running!");
    expect(() => stopTelegramBot()).not.toThrow();
  });
});
