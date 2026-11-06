import z from "zod/v4";
import type { ProxyMarked, Remote } from "comlink";
import type {
  AccountConfig,
  AccountScrapeResult,
  RunTiming,
} from "../types.js";
import type { UsedDomains } from "../security/domains.js";

export const TraceCarrierSchema = z.strictObject({
  traceparent: z
    .string()
    .regex(/^00-(?!0{32}-)[0-9a-f]{32}-(?!0{16}-)[0-9a-f]{16}-[0-9a-f]{2}$/)
    .optional(),
  tracestate: z.string().max(512).optional(),
});
export type TraceCarrier = z.infer<typeof TraceCarrierSchema>;

export const WorkerConfigSchema = z.strictObject({
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
  traceCarrier: TraceCarrierSchema,
});
export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;
export type ScraperRunConfig = Omit<
  WorkerConfig,
  "debugFilter" | "traceCarrier"
>;

export interface WorkerResult {
  results: AccountScrapeResult[];
  domains: UsedDomains;
  telemetryFailed?: boolean;
}

export interface WorkerCallbacks {
  timing(timing: RunTiming): Promise<void>;
  status(status: string[], totalTime?: number): Promise<void>;
  warning(error: unknown, caller: string, carrier: TraceCarrier): Promise<void>;
  otp(accountIndex: number, carrier: TraceCarrier): Promise<string>;
}

export interface ScraperWorkerApi {
  scrape(
    settings: WorkerConfig,
    callbacks: Remote<WorkerCallbacks & ProxyMarked>,
  ): Promise<WorkerResult>;
  cancel(): Promise<void>;
}
