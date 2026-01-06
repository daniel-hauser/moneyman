import { AsyncLocalStorage } from "async_hooks";

export type LoggerContext = {
  prefix: string;
};

export const loggerContextStore = new AsyncLocalStorage<LoggerContext>();

export function runInLoggerContext<T extends (...args: any[]) => any>(
  fn: T,
  context: LoggerContext | undefined = loggerContextStore.getStore(),
): T {
  if (!context) return fn;
  return ((...args: Parameters<T>) =>
    loggerContextStore.run(context, () => fn(...args))) as T;
}
