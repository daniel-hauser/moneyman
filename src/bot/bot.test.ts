import { mock, mockDeep } from "jest-mock-extended";
import { Context, Telegraf } from "telegraf";
import type { UserFromGetMe } from "telegraf/types";
import { createBot } from "./bot.js";
import { logToPublicLog } from "../utils/logger.js";
import { getEventListeners } from "node:events";

jest.mock("../utils/logger.js", () => ({
  createLogger: () => jest.fn(),
  logToPublicLog: jest.fn(),
}));

jest.mock("../config.js", () => ({
  config: { options: { notifications: {} } },
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

  it("stops polling and clears the command menu", async () => {
    const handle = controller.startTelegramBot();
    await controller.shutdownTelegramBot(handle);

    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(bot.telegram.deleteMyCommands).toHaveBeenCalledWith();
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

  it.each([false, true])(
    "logs menu cleanup timeouts, including an expired deadline (%s)",
    async (alreadyAborted) => {
      const abort = new AbortController();
      if (alreadyAborted) abort.abort(new Error("menu timeout"));
      const timeout = jest
        .spyOn(AbortSignal, "timeout")
        .mockReturnValue(abort.signal);
      bot.telegram.deleteMyCommands.mockImplementationOnce(
        () => new Promise(() => {}),
      );

      const shutdown = controller.shutdownTelegramBot();
      expect(timeout).toHaveBeenCalledWith(3_000);
      abort.abort();
      await expect(shutdown).resolves.toBeUndefined();
      expect(logToPublicLog).toHaveBeenCalledWith(
        "Failed to clear Telegram command menu",
        expect.any(Function),
      );
    },
  );

  it("releases the deadline wait when menu cleanup completes first", async () => {
    const timeout = new AbortController();
    jest.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const combined = jest.spyOn(AbortSignal, "any");
    await controller.shutdownTelegramBot();
    expect(
      getEventListeners(combined.mock.results[0].value as AbortSignal, "abort"),
    ).toEqual([]);
    timeout.abort(new Error("late timeout"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logToPublicLog).not.toHaveBeenCalled();
  });

  it("bounds polling shutdown and menu cleanup under the same deadline", async () => {
    const timeout = new AbortController();
    jest.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    const handle = controller.startTelegramBot();
    bot.stop.mockImplementation(() => {});
    bot.telegram.deleteMyCommands.mockImplementation(
      () => new Promise(() => {}),
    );

    const shutdown = controller.shutdownTelegramBot(handle);
    timeout.abort(new Error("shutdown deadline"));
    await expect(shutdown).resolves.toBeUndefined();

    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(logToPublicLog).toHaveBeenCalledWith(
      "Failed to clear Telegram command menu",
      expect.any(Function),
    );
  });

  it("handles a command RPC rejection after the deadline already won", async () => {
    const timeout = new AbortController();
    const deletion = Promise.withResolvers<true>();
    jest.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    bot.telegram.deleteMyCommands.mockReturnValueOnce(deletion.promise);
    const shutdown = controller.shutdownTelegramBot();
    timeout.abort(new Error("menu timeout"));
    await shutdown;
    deletion.reject(new Error("late Telegram RPC failure"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logToPublicLog).toHaveBeenCalledTimes(1);
  });

  it("returns the lifetime of the owner-launched polling", async () => {
    const handle = controller.startTelegramBot();
    expect(bot.launch).toHaveBeenCalledTimes(1);
    await handle.stop();
    await expect(handle.lifetime).resolves.toBeUndefined();
  });

  it("keeps the lifetime pending after the launch callback", async () => {
    let onLaunch!: () => void;
    bot.launch.mockImplementationOnce((config, callback) => {
      onLaunch = typeof config === "function" ? config : callback!;
      return polling.promise;
    });

    const handle = controller.startTelegramBot();
    await Promise.resolve();
    expect(bot.launch).toHaveBeenCalledTimes(1);

    onLaunch();
    expect(
      await Promise.race([
        handle.lifetime.then(() => "resolved"),
        Promise.resolve("pending"),
      ]),
    ).toBe("pending");
    await handle.stop();
    await handle.lifetime;
    expect(bot.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps the server launch promise pending until polling stops", async () => {
    const handle = controller.startTelegramBot();
    const state = await Promise.race([
      handle.lifetime.then(() => "resolved"),
      Promise.resolve("pending"),
    ]);

    expect(state).toBe("pending");
    await handle.stop();
    await expect(handle.lifetime).resolves.toBeUndefined();
  });

  it("shares the in-flight shutdown with concurrent callers", async () => {
    const deletion = Promise.withResolvers<true>();
    bot.telegram.deleteMyCommands.mockReturnValueOnce(deletion.promise);
    const handle = controller.startTelegramBot();

    const first = controller.shutdownTelegramBot(handle);
    const second = controller.shutdownTelegramBot(handle);

    expect(second).toBe(first);
    expect(bot.telegram.deleteMyCommands).toHaveBeenCalledTimes(1);
    deletion.resolve(true);
    await Promise.all([first, second]);
  });

  it("keeps repeated shutdowns waiting for the original polling stop", async () => {
    const handle = controller.startTelegramBot();
    bot.stop.mockImplementation(() => {});
    const first = controller.shutdownTelegramBot(handle);
    const second = controller.shutdownTelegramBot(handle);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(
      await Promise.race([
        second.then(() => "stopped"),
        Promise.resolve("pending"),
      ]),
    ).toBe("pending");
    polling.resolve();
    await Promise.all([first, second]);
  });

  it("awaits the same in-flight polling stop for repeated callers", async () => {
    const handle = controller.startTelegramBot();
    bot.stop.mockImplementation(() => {});

    const first = handle.stop();
    const second = handle.stop();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(bot.stop).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(
      await Promise.race([
        second!.then(() => "stopped"),
        Promise.resolve("pending"),
      ]),
    ).toBe("pending");
    polling.resolve();
    await Promise.all([first, second]);
  });

  it("does not let one caller's deadline end the shared stop", async () => {
    const handle = controller.startTelegramBot();
    bot.stop.mockImplementation(() => {});
    const deadline = new AbortController();
    const first = handle.stop(deadline.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    deadline.abort();
    await first;

    const second = handle.stop();
    expect(
      await Promise.race([
        second.then(() => "stopped"),
        Promise.resolve("pending"),
      ]),
    ).toBe("pending");
    expect(bot.stop).toHaveBeenCalledTimes(1);
    polling.resolve();
    await second;
  });

  it("does not stop an already settled launch", async () => {
    const handle = controller.startTelegramBot();
    polling.resolve();
    await handle.lifetime;
    await handle.stop();
    expect(bot.stop).not.toHaveBeenCalled();
  });

  it("permits a retry after polling startup fails", async () => {
    bot.launch.mockRejectedValueOnce(new Error("polling failed"));

    await expect(controller.startTelegramBot().lifetime).rejects.toThrow(
      "polling failed",
    );

    const running = controller.startTelegramBot();

    expect(bot.launch).toHaveBeenCalledTimes(2);
    await running.stop();
    await expect(running.lifetime).resolves.toBeUndefined();
  });

  describe("Telegraf startup and shutdown boundary", () => {
    afterEach(() => jest.restoreAllMocks());

    it("propagates webhook deletion failure after Telegraf's launch callback", async () => {
      const bot = new Telegraf<Context>("invented-token");
      const webhook = Promise.withResolvers<true>();
      jest
        .spyOn(bot.telegram, "getMe")
        .mockResolvedValue(mock<UserFromGetMe>({ username: "test_bot" }));
      jest
        .spyOn(bot.telegram, "deleteWebhook")
        .mockReturnValue(webhook.promise);
      const controller = createBot(bot);
      const running = controller.startTelegramBot();
      const failure = expect(running.lifetime).rejects.toThrow(
        "webhook failed",
      );
      await Promise.resolve();
      expect(bot.telegram.deleteWebhook).toHaveBeenCalled();

      const shutdown = running.stop();
      webhook.reject(new Error("webhook failed"));
      await Promise.all([failure, shutdown]);
    });

    it.each(["getMe", "deleteWebhook"] as const)(
      "waits for shutdown requested during %s and stops the eventual polling",
      async (stage) => {
        const bot = new Telegraf<Context>("invented-token");
        const getMe = Promise.withResolvers<UserFromGetMe>();
        const deleteWebhook = Promise.withResolvers<true>();
        const updates = Promise.withResolvers<never>();
        const pollingStarted = Promise.withResolvers<void>();
        jest.spyOn(bot.telegram, "getMe").mockReturnValue(getMe.promise);
        jest
          .spyOn(bot.telegram, "deleteWebhook")
          .mockReturnValue(deleteWebhook.promise);
        jest.spyOn(bot.telegram, "callApi").mockImplementation(() => {
          pollingStarted.resolve();
          return updates.promise;
        });
        const stop = jest.spyOn(bot, "stop");
        const controller = createBot(bot);
        const running = controller.startTelegramBot();

        if (stage === "deleteWebhook") {
          getMe.resolve(mock<UserFromGetMe>({ username: "test_bot" }));
          await Promise.resolve();
          expect(bot.telegram.deleteWebhook).toHaveBeenCalled();
        }

        const shutdown = running.stop();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(stop).toHaveBeenCalledTimes(1);
        expect(
          await Promise.race([
            shutdown!.then(() => "stopped"),
            Promise.resolve("pending"),
          ]),
        ).toBe("pending");
        getMe.resolve(mock<UserFromGetMe>({ username: "test_bot" }));
        deleteWebhook.resolve(true);
        await pollingStarted.promise;
        await new Promise<void>((resolve) => setTimeout(resolve, 150));
        expect(stop).toHaveBeenCalledTimes(2);
        const abort = new Error("polling aborted");
        abort.name = "AbortError";
        updates.reject(abort);
        await Promise.all([running.lifetime, shutdown]);
      },
    );

    it("continues stopping a delayed launch after the shutdown deadline", async () => {
      const bot = new Telegraf<Context>("invented-token");
      const getMe = Promise.withResolvers<UserFromGetMe>();
      const updates = Promise.withResolvers<never>();
      const pollingStarted = Promise.withResolvers<void>();
      const deadline = new AbortController();
      jest.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
      jest.spyOn(bot.telegram, "getMe").mockReturnValue(getMe.promise);
      jest.spyOn(bot.telegram, "deleteWebhook").mockResolvedValue(true);
      jest.spyOn(bot.telegram, "deleteMyCommands").mockResolvedValue(true);
      jest.spyOn(bot.telegram, "callApi").mockImplementation(() => {
        pollingStarted.resolve();
        return updates.promise;
      });
      const stop = jest.spyOn(bot, "stop");
      const controller = createBot(bot);
      const handle = controller.startTelegramBot();
      const shutdown = controller.shutdownTelegramBot(handle);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stop).toHaveBeenCalledTimes(1);
      deadline.abort();
      await shutdown;

      getMe.resolve(mock<UserFromGetMe>({ username: "test_bot" }));
      await pollingStarted.promise;
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      expect(stop).toHaveBeenCalledTimes(2);
      const abort = new Error("polling aborted");
      abort.name = "AbortError";
      updates.reject(abort);
      await handle.lifetime;
    });
  });

  it("propagates startup failures after the launch callback", async () => {
    const running = controller.startTelegramBot();
    polling.reject(new Error("Webhook deletion failed"));

    await expect(running.lifetime).rejects.toThrow("Webhook deletion failed");
  });

  it("stops polling only when running", async () => {
    const handle = controller.startTelegramBot();
    await handle.stop();
    await handle.stop();

    expect(bot.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps shutting down when Telegraf has nothing to stop yet", async () => {
    const handle = controller.startTelegramBot();
    bot.stop.mockImplementationOnce(() => {
      throw new Error("Bot is not running!");
    });

    await handle.stop();
  });

  it("retries stop when shutdown races with Telegraf polling startup", async () => {
    let onLaunch!: () => void;
    let pollingReady = false;
    bot.launch.mockImplementationOnce((config, callback) => {
      onLaunch = typeof config === "function" ? config : callback!;
      return polling.promise;
    });
    bot.stop.mockImplementation(() => {
      if (!pollingReady) throw new Error("Bot is not running!");
      polling.resolve();
    });

    const startup = controller.startTelegramBot();
    const shutdown = startup.stop();
    await new Promise<void>((resolve) => setImmediate(resolve));
    onLaunch();
    pollingReady = true;

    await Promise.all([startup.lifetime, shutdown]);
    expect(bot.stop).toHaveBeenCalledTimes(2);
  });

  it("rejects startup when Telegram is not configured", async () => {
    const unconfigured = createBot(null);

    const handle = unconfigured.startTelegramBot();
    await expect(handle.lifetime).rejects.toThrow("Telegram is not configured");
    await handle.stop();
    await expect(unconfigured.shutdownTelegramBot()).resolves.toBeUndefined();
  });
});
