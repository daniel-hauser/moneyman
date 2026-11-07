import { truncateError } from "../bot/truncateError.js";

type ProcessErrorSource = {
  on(
    event: "uncaughtException",
    listener: (error: Error, origin: string) => void,
  ): unknown;
  on(
    event: "unhandledRejection",
    listener: (reason: unknown, promise: Promise<unknown>) => void,
  ): unknown;
  removeListener(
    event: "uncaughtException",
    listener: (error: Error, origin: string) => void,
  ): unknown;
  removeListener(
    event: "unhandledRejection",
    listener: (reason: unknown, promise: Promise<unknown>) => void,
  ): unknown;
};
type ErrorLogger = (message: string, ...details: unknown[]) => void;
type ProcessErrorExit = (
  error: unknown,
  waitForNotifications: () => Promise<void>,
) => void;

export interface ProcessErrorHandlers {
  signal: AbortSignal;
  dispose(): void;
  waitForNotifications(): Promise<void>;
}

export function registerProcessErrorHandlers({
  logger,
  notify,
  exit,
  process: processSource = process,
}: {
  logger: ErrorLogger;
  notify: (message: string) => Promise<unknown>;
  exit: ProcessErrorExit;
  process?: ProcessErrorSource;
}): ProcessErrorHandlers {
  const controller = new AbortController();
  let notifications = Promise.resolve();

  const handle = (
    kind: "Uncaught exception" | "Unhandled rejection",
    error: unknown,
    ...details: unknown[]
  ) => {
    logger(kind, error, ...details);
    notifications = notifications.then(async () => {
      try {
        await notify(truncateError(`${kind}. See private logs.`));
      } catch (notificationError) {
        logger("Failed to send process error notification", notificationError);
      }
    });
    controller.abort(error);
    exit(error, () => notifications);
  };

  const onUncaughtException = (error: Error, origin: string) => {
    handle("Uncaught exception", error, origin);
  };
  const onUnhandledRejection = (
    reason: unknown,
    _promise: Promise<unknown>,
  ) => {
    handle("Unhandled rejection", reason);
  };

  controller.signal.addEventListener(
    "abort",
    () => {
      processSource.removeListener("uncaughtException", onUncaughtException);
      processSource.removeListener("unhandledRejection", onUnhandledRejection);
    },
    { once: true },
  );
  processSource.on("uncaughtException", onUncaughtException);
  processSource.on("unhandledRejection", onUnhandledRejection);

  return {
    signal: controller.signal,
    dispose: () => controller.abort(),
    waitForNotifications: () => notifications,
  };
}
