import type { EventEmitter } from "node:events";
import type { ProcessEventMap } from "node:process";
import { formatUnknownError } from "./utils.js";

type ErrorLogger = (message: string, ...details: unknown[]) => void;
type ProcessHandlerReason = NodeJS.Signals | "process error";

export interface ProcessHandlers {
  signal: AbortSignal;
  readonly reason: ProcessHandlerReason | undefined;
  dispose(): void;
  reportUnhandledRejection(error: unknown): void;
  waitForNotifications(): Promise<void>;
}

export function registerProcessHandlers({
  logger,
  notify,
  onFatal,
  process: processSource = process,
}: {
  logger: ErrorLogger;
  notify: (message: string) => Promise<unknown>;
  onFatal: (error: unknown) => void;
  process?: EventEmitter<ProcessEventMap>;
}): ProcessHandlers {
  const controller = new AbortController();
  const cleanup = new DisposableStack();
  let notifications = Promise.resolve();
  let reason: ProcessHandlerReason | undefined;

  function dispose() {
    cleanup.dispose();
  }

  function stop(stopReason: ProcessHandlerReason, abortReason: unknown) {
    if (controller.signal.aborted) return;

    reason = stopReason;
    dispose();
    controller.abort(abortReason);
  }

  const handle = (
    kind: "Uncaught exception" | "Unhandled rejection",
    error: unknown,
    message: string,
    ...details: unknown[]
  ) => {
    logger(kind, error, ...details);
    notifications = notifications.then(async () => {
      try {
        await notify(message);
      } catch (notificationError) {
        logger("Failed to send process error notification", notificationError);
      }
    });
    stop("process error", error);
    onFatal(error);
  };

  const onUncaughtException = (error: Error, origin: string) => {
    console.error("uncaughtException, sending error");
    handle(
      "Uncaught exception",
      error,
      `
    Caught exception: ${error}
    err.stack: ${error.stack}
    Exception origin: ${origin}`,
      origin,
    );
  };
  const reportUnhandledRejection = (error: unknown) =>
    handle(
      "Unhandled rejection",
      error,
      `Unhandled rejection: ${formatUnknownError(error)}${error instanceof Error && error.stack ? `\n${error.stack}` : ""}`,
    );
  const onUnhandledRejection = (
    reason: unknown,
    _promise: Promise<unknown>,
  ) => {
    reportUnhandledRejection(reason);
  };
  const onSigint = () => stop("SIGINT", new Error("Scraper worker cancelled"));
  const onSigterm = () =>
    stop("SIGTERM", new Error("Scraper worker cancelled"));

  processSource.on("uncaughtException", onUncaughtException);
  cleanup.defer(() =>
    processSource.removeListener("uncaughtException", onUncaughtException),
  );
  processSource.on("unhandledRejection", onUnhandledRejection);
  cleanup.defer(() =>
    processSource.removeListener("unhandledRejection", onUnhandledRejection),
  );
  processSource.on("SIGINT", onSigint);
  cleanup.defer(() => processSource.removeListener("SIGINT", onSigint));
  processSource.on("SIGTERM", onSigterm);
  cleanup.defer(() => processSource.removeListener("SIGTERM", onSigterm));

  return {
    signal: controller.signal,
    get reason() {
      return reason;
    },
    dispose,
    reportUnhandledRejection,
    waitForNotifications: () => notifications,
  };
}
