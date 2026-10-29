import { mock, mockDeep } from "jest-mock-extended";
import { Context, Telegraf, type MiddlewareFn } from "telegraf";
import type { Message } from "telegraf/types";
import { createOtpHandler } from "./otp.js";

jest.mock("../config.js", () => ({
  config: {
    options: {
      notifications: {
        telegram: {
          chatId: "555",
          enableOtp: true,
          otpTimeoutSeconds: 3600,
        },
      },
    },
  },
}));

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function settleState(promise: Promise<unknown>) {
  return Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected",
    ),
    flush().then(() => "pending"),
  ]);
}

describe("createOtpHandler", () => {
  const bot = mockDeep<Telegraf<Context>>();
  const polling = mock<Parameters<typeof createOtpHandler>[1]>();
  let requestOtpCode: ReturnType<typeof createOtpHandler>;

  beforeEach(() => {
    jest.clearAllMocks();
    let nextMessageId = 1;
    bot.telegram.sendMessage.mockImplementation(async () =>
      mock<Message.TextMessage>({ message_id: nextMessageId++ }),
    );
    polling.isTelegramBotRunning.mockReturnValue(false);
    polling.launchTelegramBot.mockImplementation(async () => {
      polling.isTelegramBotRunning.mockReturnValue(true);
    });
    requestOtpCode = createOtpHandler(bot, polling);
  });

  async function reply(index: number, text: string, replyToMessageId?: number) {
    const handler = bot.on.mock.calls[index][1] as MiddlewareFn<Context>;
    if (typeof handler !== "function") {
      throw new Error("Expected an OTP middleware function");
    }
    const ctx = mock<Context>({
      chat: { id: 555, type: "private", first_name: "user" },
      message: {
        text,
        reply_to_message:
          replyToMessageId === undefined
            ? undefined
            : {
                message_id: replyToMessageId,
                date: 0,
                chat: { id: 555, type: "private", first_name: "user" },
                text: "OTP request",
                reply_to_message: undefined,
              },
      },
    });
    ctx.reply.mockResolvedValue(mock<Message.TextMessage>());
    await handler(ctx, async () => {});
  }

  it("matches concurrent replies and stops polling after the last request", async () => {
    const first = requestOtpCode("oneZero", "+97200000001");
    const second = requestOtpCode("oneZero", "+97200000002");
    await flush();

    expect(bot.on).toHaveBeenCalledTimes(1);
    expect(polling.launchTelegramBot).toHaveBeenCalledTimes(1);

    await reply(0, "999999");
    expect(await settleState(first)).toBe("pending");
    expect(await settleState(second)).toBe("pending");

    await reply(0, "222222", 2);
    expect(await settleState(first)).toBe("pending");
    await reply(0, "222222", 2);
    await expect(second).resolves.toBe("222222");
    expect(await settleState(first)).toBe("pending");
    expect(polling.stopTelegramBot).not.toHaveBeenCalled();

    await reply(0, "111111");
    await expect(first).resolves.toBe("111111");
    expect(polling.stopTelegramBot).toHaveBeenCalledTimes(1);
  });

  it("does not start or stop polling owned by the server", async () => {
    polling.isTelegramBotRunning.mockReturnValue(true);
    const request = requestOtpCode("oneZero", "+97200000001");
    await flush();

    await reply(0, "123456");

    await expect(request).resolves.toBe("123456");
    expect(polling.launchTelegramBot).not.toHaveBeenCalled();
    expect(polling.stopTelegramBot).not.toHaveBeenCalled();
  });

  it("rejects the request and notifies the chat when polling fails", async () => {
    polling.launchTelegramBot.mockRejectedValueOnce(
      new Error("polling failed"),
    );

    await expect(requestOtpCode("oneZero", "+97200000001")).rejects.toThrow(
      "Failed to start Telegram bot for OTP: Error: polling failed",
    );
    expect(polling.stopTelegramBot).toHaveBeenCalledTimes(1);
    expect(bot.telegram.sendMessage).toHaveBeenLastCalledWith(
      "555",
      expect.stringContaining("requestOtpCode\n❌ polling failed"),
    );
  });

  it("rejects requests when Telegram is not configured", async () => {
    await expect(
      createOtpHandler(null, polling)("oneZero", "+97200000001"),
    ).rejects.toThrow("Telegram OTP is not enabled or configured");
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("reuses one dispatcher across completed requests", async () => {
    for (let i = 1; i <= 5; i++) {
      const request = requestOtpCode("oneZero", "+97200000001");
      await flush();
      await reply(0, "123456", i);
      await expect(request).resolves.toBe("123456");
    }
    expect(bot.on).toHaveBeenCalledTimes(1);
  });

  it("ignores commands and replies targeting completed requests", async () => {
    const first = requestOtpCode("oneZero", "+97200000001");
    await flush();
    await reply(0, "111111", 1);
    await first;

    const second = requestOtpCode("oneZero", "+97200000002");
    await flush();
    await reply(0, "/status");
    await reply(0, "111111", 1);
    expect(await settleState(second)).toBe("pending");
    await reply(0, "222222", 2);
    await expect(second).resolves.toBe("222222");
  });

  it("removes timed-out requests so a later plain reply is unambiguous", async () => {
    const controller = new AbortController();
    const timeout = jest
      .spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(controller.signal);
    try {
      const expired = requestOtpCode("oneZero", "+97200000001");
      const rejected = expect(expired).rejects.toThrow("OTP timeout");
      await flush();
      expect(timeout).toHaveBeenCalledWith(3_600_000);
      controller.abort();
      await rejected;

      const next = requestOtpCode("oneZero", "+97200000002");
      await flush();
      await reply(0, "654321");
      await expect(next).resolves.toBe("654321");
      expect(bot.on).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });
});
