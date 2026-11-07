import { mock, mockDeep } from "jest-mock-extended";
import { Context, Telegraf, type MiddlewareFn } from "telegraf";
import type { Message } from "telegraf/types";
import { createOtpHandler } from "./otp.js";
import { getEventListeners } from "node:events";

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
  let releases: jest.Mock[];

  beforeEach(() => {
    jest.clearAllMocks();
    releases = [];
    let nextMessageId = 1;
    bot.telegram.sendMessage.mockImplementation(async () =>
      mock<Message.TextMessage>({ message_id: nextMessageId++ }),
    );
    polling.acquireOtpPolling.mockImplementation(() => {
      const release = jest.fn();
      releases.push(release);
      return { started: Promise.resolve(), release };
    });
    requestOtpCode = createOtpHandler(bot, polling);
  });

  afterEach(() => jest.restoreAllMocks());

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

  it("matches concurrent replies and releases each polling lease", async () => {
    const first = requestOtpCode("oneZero", "+97200000001");
    const second = requestOtpCode("oneZero", "+97200000002");
    await flush();

    expect(bot.on).toHaveBeenCalledTimes(1);
    expect(polling.acquireOtpPolling).toHaveBeenCalledTimes(2);

    await reply(0, "999999");
    expect(await settleState(first)).toBe("pending");
    expect(await settleState(second)).toBe("pending");

    await reply(0, "222222", 2);
    expect(await settleState(first)).toBe("pending");
    await reply(0, "222222", 2);
    await expect(second).resolves.toBe("222222");
    expect(await settleState(first)).toBe("pending");
    expect(releases[1]).toHaveBeenCalledTimes(1);

    await reply(0, "111111");
    await expect(first).resolves.toBe("111111");
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });

  it("releases its polling lease when the server also owns polling", async () => {
    const request = requestOtpCode("oneZero", "+97200000001");
    await flush();

    await reply(0, "123456");

    await expect(request).resolves.toBe("123456");
    expect(releases[0]).toHaveBeenCalledTimes(1);
  });

  it("rejects the request and notifies the chat when polling fails", async () => {
    const release = jest.fn();
    polling.acquireOtpPolling.mockReturnValueOnce({
      started: Promise.reject(new Error("polling failed")),
      release,
    });

    await expect(requestOtpCode("oneZero", "+97200000001")).rejects.toThrow(
      "Failed to start Telegram bot for OTP: Error: polling failed",
    );
    expect(release).toHaveBeenCalledTimes(1);
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
    const combined = jest.spyOn(AbortSignal, "any");
    for (let i = 1; i <= 5; i++) {
      const request = requestOtpCode("oneZero", "+97200000001");
      await flush();
      await reply(0, "123456", i);
      await expect(request).resolves.toBe("123456");
    }
    expect(bot.on).toHaveBeenCalledTimes(1);
    for (const { value } of combined.mock.results) {
      expect(getEventListeners(value as AbortSignal, "abort")).toEqual([]);
    }
  });

  it("releases its polling lease when a worker OTP is cancelled", async () => {
    const abort = new AbortController();
    const request = requestOtpCode("oneZero", "+97200000001", abort.signal);
    const rejected = expect(request).rejects.toThrow("worker exited");
    await flush();
    abort.abort(new Error("worker exited"));
    await rejected;
    expect(releases[0]).toHaveBeenCalledTimes(1);

    const next = requestOtpCode("oneZero", "+97200000002");
    await flush();
    await reply(0, "654321");
    await expect(next).resolves.toBe("654321");
  });

  it("does not start an OTP request after the worker already exited", async () => {
    const abort = new AbortController();
    abort.abort(new Error("worker exited"));
    await expect(
      requestOtpCode("oneZero", "+97200000001", abort.signal),
    ).rejects.toThrow("worker exited");
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
    expect(polling.acquireOtpPolling).not.toHaveBeenCalled();
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

  it.each([false, true])(
    "removes timed-out requests, including an expired deadline (%s)",
    async (alreadyAborted) => {
      const controller = new AbortController();
      if (alreadyAborted) controller.abort(new Error("expired OTP deadline"));
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
    },
  );
});
