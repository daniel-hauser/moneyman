import { EventEmitter } from "node:events";
import { mock } from "jest-mock-extended";
import { registerProcessErrorHandlers } from "./processErrors.js";

type ErrorLogger = { log(message: string, ...details: unknown[]): void };
type Notify = { notify(message: string): Promise<unknown> };
type ProcessErrorExit = (
  error: unknown,
  waitForNotifications: () => Promise<void>,
) => void;

describe("registerProcessErrorHandlers", () => {
  it("logs and sanitizes uncaught exceptions, then requests exit", async () => {
    const source = new EventEmitter();
    const logger = mock<ErrorLogger>();
    const notifier = mock<Notify>();
    const exit = jest.fn<void, Parameters<ProcessErrorExit>>();
    const handlers = registerProcessErrorHandlers({
      logger: logger.log,
      notify: notifier.notify,
      exit,
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
    expect(source.listenerCount("uncaughtException")).toBe(0);
    expect(source.listenerCount("unhandledRejection")).toBe(0);
    expect(exit).toHaveBeenCalledWith(error, expect.any(Function));

    await handlers.waitForNotifications();
    expect(notifier.notify).toHaveBeenCalledWith(
      "Uncaught exception. See private logs.",
    );
    expect(notifier.notify.mock.calls[0][0]).not.toContain("secret-token");
    expect(notifier.notify.mock.calls[0][0]).not.toContain("private/path");
    handlers.dispose();
  });

  it("handles unhandled rejections and logs notification failures privately", async () => {
    const source = new EventEmitter();
    const logger = mock<ErrorLogger>();
    const notifier = mock<Notify>();
    const exit = jest.fn<void, Parameters<ProcessErrorExit>>();
    const handlers = registerProcessErrorHandlers({
      logger: logger.log,
      notify: notifier.notify,
      exit,
      process: source,
    });
    const reason = "private rejection details";
    const notificationError = new Error("telegram failure");
    notifier.notify.mockRejectedValue(notificationError);

    source.emit("unhandledRejection", reason, Promise.resolve());

    expect(logger.log).toHaveBeenCalledWith("Unhandled rejection", reason);
    expect(exit).toHaveBeenCalledWith(reason, expect.any(Function));
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
});
