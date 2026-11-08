import { mock, mockDeep } from "jest-mock-extended";
import { Context, Telegraf } from "telegraf";
import type { Message, UserFromGetMe } from "telegraf/types";
import { createBot } from "./bot.js";
import { logToPublicLog } from "../utils/logger.js";

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

describe("createBot", () => {
  const bot = mockDeep<Telegraf<Context>>();
  let controller: ReturnType<typeof createBot>;
  let polling: PromiseWithResolvers<void>;

  beforeEach(() => {
    jest.clearAllMocks();
    polling = Promise.withResolvers<void>();
    bot.launch.mockImplementation((config, onLaunch) => {
      (typeof config === "function" ? config : onLaunch)?.();
      return polling.promise;
    });
    bot.stop.mockImplementation(() => polling.resolve());
    bot.telegram.deleteMyCommands.mockResolvedValue(true);
    controller = createBot(bot);
  });

  afterEach(() => jest.restoreAllMocks());

  it("lazily creates one polling lifetime and returns it to all launch callers", async () => {
    expect(bot.launch).not.toHaveBeenCalled();

    const first = controller.launchTelegramBot();
    const second = controller.launchTelegramBot();

    expect(bot.launch).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    await controller.stopTelegramBot();
    await expect(first).resolves.toBeUndefined();
  });

  it("does not mistake Telegraf's launch callback for polling readiness", async () => {
    let onLaunch!: () => void;
    bot.launch.mockImplementationOnce((config, callback) => {
      onLaunch = typeof config === "function" ? config : callback!;
      return polling.promise;
    });
    const lifetime = controller.launchTelegramBot();

    onLaunch();
    expect(
      await Promise.race([
        lifetime.then(() => "resolved"),
        Promise.resolve("pending"),
      ]),
    ).toBe("pending");
    await controller.stopTelegramBot();
    await expect(lifetime).resolves.toBeUndefined();
  });

  it("stops polling without clearing the command menu", async () => {
    controller.launchTelegramBot();
    await controller.stopTelegramBot();

    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(bot.telegram.deleteMyCommands).not.toHaveBeenCalled();
  });

  it("clears the menu before launch and shares repeated shutdown work", async () => {
    const deletion = Promise.withResolvers<true>();
    bot.telegram.deleteMyCommands.mockReturnValueOnce(deletion.promise);

    const first = controller.shutdownTelegramBot();
    const second = controller.shutdownTelegramBot();

    expect(first).toBe(second);
    expect(bot.launch).not.toHaveBeenCalled();
    expect(bot.telegram.deleteMyCommands).toHaveBeenCalledTimes(1);
    deletion.resolve(true);
    await Promise.all([first, second]);
  });

  it("bounds polling shutdown and menu cleanup under one deadline", async () => {
    const deadline = new AbortController();
    jest.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    controller.launchTelegramBot();
    bot.stop.mockImplementation(() => {});
    bot.telegram.deleteMyCommands.mockImplementation(
      () => new Promise(() => {}),
    );

    const shutdown = controller.shutdownTelegramBot();
    deadline.abort(new Error("shutdown deadline"));
    await expect(shutdown).resolves.toBeUndefined();

    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(logToPublicLog).toHaveBeenCalledWith(
      "Failed to clear Telegram command menu",
      expect.any(Function),
    );
  });

  it("logs menu cleanup failures without rejecting shutdown", async () => {
    bot.telegram.deleteMyCommands.mockRejectedValueOnce(
      new Error("Telegram unavailable"),
    );

    await expect(controller.shutdownTelegramBot()).resolves.toBeUndefined();
    expect(logToPublicLog).toHaveBeenCalledWith(
      "Failed to clear Telegram command menu",
      expect.any(Function),
    );
  });

  it("awaits the original in-flight polling stop for repeated callers", async () => {
    controller.launchTelegramBot();
    bot.stop.mockImplementation(() => {});

    const first = controller.stopTelegramBot();
    const second = controller.stopTelegramBot();
    expect(first).toBe(second);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      await Promise.race([
        second.then(() => "stopped"),
        Promise.resolve("pending"),
      ]),
    ).toBe("pending");

    polling.resolve();
    await Promise.all([first, second]);
  });

  it("attempts the native stop once while Telegraf has not started polling", async () => {
    bot.stop.mockImplementation(() => {
      throw new Error("Bot is not running!");
    });
    const lifetime = controller.launchTelegramBot();

    await controller.stopTelegramBot();

    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(controller.launchTelegramBot()).toBe(lifetime);
    expect(bot.launch).toHaveBeenCalledTimes(1);
    polling.resolve();
    await lifetime;
  });

  it("permits a retry after polling startup fails", async () => {
    bot.launch.mockRejectedValueOnce(new Error("polling failed"));

    await expect(controller.launchTelegramBot()).rejects.toThrow(
      "polling failed",
    );

    const running = controller.launchTelegramBot();

    expect(bot.launch).toHaveBeenCalledTimes(2);
    await controller.stopTelegramBot();
    await expect(running).resolves.toBeUndefined();
  });

  it("rejects OTP prompts before polling is launched", async () => {
    await expect(
      controller.requestOtpCode("oneZero", "+97200000001"),
    ).rejects.toThrow("Telegram bot polling is unavailable");
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it.each(["failure", "stop"] as const)(
    "cancels pending OTP and rejects new prompts after polling %s",
    async (ending) => {
      bot.telegram.sendMessage.mockResolvedValue(
        mock<Message.TextMessage>({ message_id: 1 }),
      );
      const lifetime = controller.launchTelegramBot();
      const request = controller.requestOtpCode("oneZero", "+97200000001");
      const error =
        ending === "failure"
          ? new Error("polling failed")
          : new Error("Telegram bot stopped while waiting for OTP");
      const rejected = expect(request).rejects.toThrow(error);
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (ending === "failure") {
        polling.reject(error);
        await expect(lifetime).rejects.toBe(error);
      } else {
        await controller.stopTelegramBot();
      }
      await rejected;
      await expect(
        controller.requestOtpCode("oneZero", "+97200000002"),
      ).rejects.toThrow(error);
      expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["getMe", "deleteWebhook"] as const)(
    "propagates %s failures from the actual Telegraf launch promise",
    async (stage) => {
      const actual = new Telegraf<Context>("invented-token");
      const getMe = Promise.withResolvers<UserFromGetMe>();
      const deleteWebhook = Promise.withResolvers<true>();
      jest.spyOn(actual.telegram, "getMe").mockReturnValue(getMe.promise);
      jest
        .spyOn(actual.telegram, "deleteWebhook")
        .mockReturnValue(deleteWebhook.promise);
      const lifecycle = createBot(actual);
      const lifetime = lifecycle.launchTelegramBot();

      if (stage === "getMe") {
        getMe.reject(new Error("getMe failed"));
        await expect(lifetime).rejects.toThrow("getMe failed");
      } else {
        getMe.resolve(
          mock<UserFromGetMe>({
            id: 1,
            is_bot: true,
            first_name: "test",
            username: "test_bot",
          }),
        );
        await Promise.resolve();
        deleteWebhook.reject(new Error("deleteWebhook failed"));
        await expect(lifetime).rejects.toThrow("deleteWebhook failed");
      }
    },
  );
});
