import { EventEmitter } from "node:events";
import type { ProcessEventMap } from "node:process";
import { mock } from "jest-mock-extended";
import { registerProcessHandlers } from "./processErrors.js";

type ErrorLogger = { log(message: string, ...details: unknown[]): void };
type Notify = { notify(message: string): Promise<unknown> };

describe("registerProcessHandlers", () => {
  it("logs and sanitizes uncaught exceptions, then reports a fatal error", async () => {
    const source = new EventEmitter<ProcessEventMap>();
    const logger = mock<ErrorLogger>();
    const notifier = mock<Notify>();
    const onFatal = jest.fn();
    const handlers = registerProcessHandlers({
      logger: logger.log,
      notify: notifier.notify,
      onFatal,
      process: source,
    });
    const error = new Error("secret-token");
    error.stack = "Error: secret-token\n    at private/path.js";

    source.emit("uncaughtException", error, "uncaughtException");

    expect(logger.log).toHaveBeenCalledWith(
      "Uncaught exception",
      error,
      "uncaughtException",
    );
    expect(handlers.signal.aborted).toBe(true);
    expect(handlers.signal.reason).toBe(error);
    expect(handlers.reason).toBe("process error");
    expect(source.listenerCount("uncaughtException")).toBe(0);
    expect(source.listenerCount("unhandledRejection")).toBe(0);
    expect(source.listenerCount("SIGINT")).toBe(0);
    expect(source.listenerCount("SIGTERM")).toBe(0);
    expect(onFatal).toHaveBeenCalledWith(error);

    await handlers.waitForNotifications();
    expect(notifier.notify).toHaveBeenCalledWith(
      "Uncaught exception. See private logs.",
    );
    expect(notifier.notify.mock.calls[0][0]).not.toContain("secret-token");
    expect(notifier.notify.mock.calls[0][0]).not.toContain("private/path");
    handlers.dispose();
  });

  it("handles unhandled rejections and logs notification failures privately", async () => {
    const source = new EventEmitter<ProcessEventMap>();
    const logger = mock<ErrorLogger>();
    const notifier = mock<Notify>();
    const onFatal = jest.fn();
    const handlers = registerProcessHandlers({
      logger: logger.log,
      notify: notifier.notify,
      onFatal,
      process: source,
    });
    const reason = "private rejection details";
    const notificationError = new Error("telegram failure");
    notifier.notify.mockRejectedValue(notificationError);

    source.emit("unhandledRejection", reason, Promise.resolve());

    expect(logger.log).toHaveBeenCalledWith("Unhandled rejection", reason);
    expect(onFatal).toHaveBeenCalledWith(reason);
    await handlers.waitForNotifications();
    expect(notifier.notify).toHaveBeenCalledWith(
      "Unhandled rejection. See private logs.",
    );
    expect(logger.log).toHaveBeenCalledWith(
      "Failed to send process error notification",
      notificationError,
    );
    expect(source.listenerCount("uncaughtException")).toBe(0);
    expect(source.listenerCount("unhandledRejection")).toBe(0);
    handlers.dispose();
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "cancels without reporting a fatal error on %s",
    async (signal) => {
      const source = new EventEmitter<ProcessEventMap>();
      const logger = mock<ErrorLogger>();
      const notifier = mock<Notify>();
      const onFatal = jest.fn();
      const handlers = registerProcessHandlers({
        logger: logger.log,
        notify: notifier.notify,
        onFatal,
        process: source,
      });

      source.emit(signal, signal);

      expect(handlers.signal.aborted).toBe(true);
      expect(handlers.signal.reason).toEqual(
        new Error("Scraper worker cancelled"),
      );
      expect(handlers.reason).toBe(signal);
      expect(logger.log).not.toHaveBeenCalled();
      expect(notifier.notify).not.toHaveBeenCalled();
      expect(onFatal).not.toHaveBeenCalled();
      expect(source.listenerCount("uncaughtException")).toBe(0);
      expect(source.listenerCount("unhandledRejection")).toBe(0);
      expect(source.listenerCount("SIGINT")).toBe(0);
      expect(source.listenerCount("SIGTERM")).toBe(0);
      await handlers.waitForNotifications();
    },
  );

  it("disposes all process listeners without aborting the lifecycle signal", () => {
    const source = new EventEmitter<ProcessEventMap>();
    const handlers = registerProcessHandlers({
      logger: jest.fn(),
      notify: jest.fn().mockResolvedValue(undefined),
      onFatal: jest.fn(),
      process: source,
    });

    handlers.dispose();
    handlers.dispose();

    expect(handlers.signal.aborted).toBe(false);
    expect(source.eventNames()).toEqual([]);
  });
});
