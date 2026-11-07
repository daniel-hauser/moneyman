import { EventEmitter } from "node:events";
import type { ProcessEventMap } from "node:process";
import { mock } from "jest-mock-extended";
import { registerProcessHandlers } from "./processErrors.js";

type ErrorLogger = { log(message: string, ...details: unknown[]): void };
type Notify = { notify(message: string): Promise<unknown> };

describe("registerProcessHandlers", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(["uncaughtException", "unhandledRejection"] as const)(
    "logs and reports an uncaught exception with %s origin",
    async (origin) => {
      const consoleError = jest.spyOn(console, "error").mockImplementation();
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

      source.emit("uncaughtException", error, origin);

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith(
        "uncaughtException, sending error",
      );
      expect(logger.log).toHaveBeenCalledWith(
        "Uncaught exception",
        error,
        origin,
      );
      expect(handlers.signal.aborted).toBe(true);
      expect(handlers.signal.reason).toBe(error);
      expect(handlers.reason).toBe("process error");
      expect(source.listenerCount("uncaughtException")).toBe(0);
      expect(source.listenerCount("unhandledRejection")).toBe(0);
      expect(source.listenerCount("SIGINT")).toBe(0);
      expect(source.listenerCount("SIGTERM")).toBe(0);
      expect(onFatal).toHaveBeenCalledWith(error);

      error.message = "changed after reporting";
      error.stack = "Error: changed after reporting";
      await handlers.waitForNotifications();
      expect(notifier.notify).toHaveBeenCalledWith(
        `
    Caught exception: Error: secret-token
    err.stack: Error: secret-token
    at private/path.js
    Exception origin: ${origin}`,
      );
      handlers.dispose();
    },
  );

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
      "Unhandled rejection: private rejection details",
    );
    expect(logger.log).toHaveBeenCalledWith(
      "Failed to send process error notification",
      notificationError,
    );
    expect(source.listenerCount("uncaughtException")).toBe(0);
    expect(source.listenerCount("unhandledRejection")).toBe(0);
    handlers.dispose();
  });

  it("reports an error with its stack after a signal stopped the lifecycle", async () => {
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
    const error = new Error("cleanup failed");
    error.stack = "Error: cleanup failed\n    at cleanup.js:1";

    source.emit("SIGTERM", "SIGTERM");
    handlers.reportUnhandledRejection(error);
    await handlers.waitForNotifications();

    expect(onFatal).toHaveBeenCalledWith(error);
    expect(logger.log).toHaveBeenCalledWith("Unhandled rejection", error);
    expect(notifier.notify).toHaveBeenCalledWith(
      "Unhandled rejection: cleanup failed\nError: cleanup failed\n    at cleanup.js:1",
    );
    expect(handlers.reason).toBe("SIGTERM");
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
