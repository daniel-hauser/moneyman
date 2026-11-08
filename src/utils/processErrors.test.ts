import { EventEmitter, getEventListeners } from "node:events";
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
      expect(source.listenerCount("uncaughtException")).toBe(1);
      expect(source.listenerCount("unhandledRejection")).toBe(1);
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
      expect(source.listenerCount("uncaughtException")).toBe(0);
      expect(source.listenerCount("unhandledRejection")).toBe(0);
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
    expect(source.listenerCount("uncaughtException")).toBe(1);
    expect(source.listenerCount("unhandledRejection")).toBe(1);
    handlers.dispose();
  });

  it("drains notifications added while an earlier notification is pending", async () => {
    const combined = jest.spyOn(AbortSignal, "any");
    const source = new EventEmitter<ProcessEventMap>();
    const logger = mock<ErrorLogger>();
    const notifier = mock<Notify>();
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    notifier.notify.mockImplementation(async (message) => {
      if (message === "Unhandled rejection: first") {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
    });
    const handlers = registerProcessHandlers({
      logger: logger.log,
      notify: notifier.notify,
      onFatal: jest.fn(),
      process: source,
    });

    source.emit("unhandledRejection", "first", Promise.resolve());
    const draining = handlers.waitForNotifications();
    await firstStarted.promise;
    source.emit("unhandledRejection", "later", Promise.resolve());
    releaseFirst.resolve();
    await draining;

    expect(notifier.notify.mock.calls.map(([message]) => message)).toEqual([
      "Unhandled rejection: first",
      "Unhandled rejection: later",
    ]);
    expect(combined).toHaveBeenCalledTimes(1);
    expect(
      getEventListeners(combined.mock.results[0].value as AbortSignal, "abort"),
    ).toEqual([]);
    expect(logger.log).not.toHaveBeenCalledWith(
      expect.stringContaining("Timed out"),
    );
    handlers.dispose();
  });

  it("bounds notification draining and logs a private timeout diagnostic", async () => {
    const source = new EventEmitter<ProcessEventMap>();
    const logger = mock<ErrorLogger>();
    const notifier = mock<Notify>();
    const deadline = new AbortController();
    const notification = Promise.withResolvers<unknown>();
    jest.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    notifier.notify.mockReturnValue(notification.promise);
    const handlers = registerProcessHandlers({
      logger: logger.log,
      notify: notifier.notify,
      onFatal: jest.fn(),
      process: source,
    });

    handlers.reportUnhandledRejection("pending notification");
    const draining = handlers.waitForNotifications();
    deadline.abort();
    await draining;

    expect(logger.log).toHaveBeenCalledWith(
      "Timed out after 3000 ms waiting for process error notifications",
    );
    handlers.dispose();
  });

  it.each([null, undefined])(
    "handles an uncaught %s value without interrupting fatal handling",
    async (error) => {
      const source = new EventEmitter<ProcessEventMap>();
      const logger = mock<ErrorLogger>();
      const notifier = mock<Notify>();
      const onFatal = jest.fn();
      const consoleError = jest.spyOn(console, "error").mockImplementation();
      const handlers = registerProcessHandlers({
        logger: logger.log,
        notify: notifier.notify,
        onFatal,
        process: source,
      });

      // @ts-expect-error Native uncaught exceptions can contain non-Error values.
      source.emit("uncaughtException", error, "uncaughtException");
      await handlers.waitForNotifications();

      expect(consoleError).toHaveBeenCalledWith(
        "uncaughtException, sending error",
      );
      expect(logger.log).toHaveBeenCalledWith(
        "Uncaught exception",
        error,
        "uncaughtException",
      );
      expect(notifier.notify).toHaveBeenCalledWith(
        `
    Caught exception: ${error}
    err.stack: undefined
    Exception origin: uncaughtException`,
      );
      expect(onFatal).toHaveBeenCalledWith(error);
      handlers.dispose();
    },
  );

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
      expect(source.listenerCount("uncaughtException")).toBe(1);
      expect(source.listenerCount("unhandledRejection")).toBe(1);
      expect(source.listenerCount("SIGINT")).toBe(0);
      expect(source.listenerCount("SIGTERM")).toBe(0);
      await handlers.waitForNotifications();
      handlers.dispose();
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
