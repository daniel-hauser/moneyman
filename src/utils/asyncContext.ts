import { AsyncLocalStorage } from "async_hooks";

export type ScraperContext = {
  index: number;
  companyId: string;
};

export const scraperContextStore = new AsyncLocalStorage<ScraperContext>();

export function runInScraperContext<T extends (...args: any[]) => any>(
  fn: T,
  context: ScraperContext | undefined = scraperContextStore.getStore(),
): T {
  if (!context) return fn;
  return ((...args: Parameters<T>) =>
    scraperContextStore.run(context, () => fn(...args))) as T;
}
