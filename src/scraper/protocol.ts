import z from "zod/v4";
import type { ProxyMarked, Remote } from "comlink";
import type {
  AccountConfig,
  AccountScrapeResult,
  RunTiming,
} from "../types.js";
import type { UsedDomains } from "../security/domains.js";

export const WorkerConfigSchema = z.strictObject({
  /** Account id -> label for the configured accounts, for run results */
  accountLabels: z.record(z.string(), z.string()).optional(),
  /**
   * Account ids computed on the main thread, index-aligned with `accounts`.
   * The id is keyed by a per-process secret, so the worker must not compute its
   * own: it would not match the ids the main thread selected, marked as failed
   * or looked up labels with.
   */
  accountIds: z.array(z.string()),
  accounts: z.array(
    z
      .looseObject({
        companyId: z.string().min(1),
        password: z.string().min(1),
      })
      .catchall(z.json()) as unknown as z.ZodType<AccountConfig>,
  ),
  startDate: z.date(),
  futureMonthsToScrape: z.number(),
  parallelScrapers: z.number().int().min(1),
  additionalTransactionInformation: z.boolean(),
  includeRawTransaction: z.boolean(),
  executablePath: z.string().optional(),
  domainTracking: z.boolean(),
  firewallSettings: z.array(z.string()),
  blockByDefault: z.boolean(),
  enableOtp: z.boolean(),
  debugFilter: z.string(),
});
export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;
export type ScraperRunConfig = Omit<WorkerConfig, "debugFilter">;

export interface WorkerResult {
  results: AccountScrapeResult[];
  domains: UsedDomains;
}

export interface WorkerCallbacks {
  timing(timing: RunTiming): Promise<void>;
  status(status: string[], totalTime?: number): Promise<void>;
  warning(error: unknown, caller: string): Promise<void>;
  otp(accountIndex: number): Promise<string>;
}

export interface ScraperWorkerApi {
  scrape(
    settings: WorkerConfig,
    callbacks: Remote<WorkerCallbacks & ProxyMarked>,
  ): Promise<WorkerResult>;
  cancel(): Promise<void>;
}
