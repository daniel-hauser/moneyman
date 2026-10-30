/// <reference lib="es2024.promise" />
/// <reference lib="esnext.disposable" />
import { MessageChannel, Worker } from "node:worker_threads";
import { addAbortListener, once } from "node:events";
import { aborted } from "node:util";
import { finalizer, proxy, releaseProxy, wrap } from "comlink";
import debug from "debug";
import type { RunnerHooks, RunTiming } from "../types.js";
import { requestOtpCode } from "../bot/notifier.js";
import { workerEnvironment } from "./environment.js";
import {
  WorkerConfigSchema,
  type ScraperWorkerApi,
  type WorkerResult,
  type ScraperRunConfig,
} from "./protocol.js";

export async function scrapeAccounts(
  scraping: ScraperRunConfig,
  onStatus?: (status: string[], totalTime?: number) => Promise<void>,
  onError?: (error: unknown, caller: string) => void | Promise<void>,
  signal?: AbortSignal,
  onTiming?: RunnerHooks["onTiming"],
): Promise<WorkerResult> {
  signal?.throwIfAborted();
  const debugFilter = debug.disable();
  debug.enable(debugFilter);
  const settings = WorkerConfigSchema.parse({
    ...scraping,
    debugFilter,
  });
  const resources = new AsyncDisposableStack();
  const activeTimings = new Map<string, RunTiming>();
  try {
    const { port1, port2 } = new MessageChannel();
    resources.defer(() => {
      port1.close();
      port2.close();
    });
    const listeners = new AbortController();
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      env: workerEnvironment(process.env),
      execArgv: [],
      workerData: port2,
      transferList: [port2],
    });
    resources.defer(async () => {
      listeners.abort();
      await worker.terminate();
    });
    const abort = new AbortController();
    const lifetime = new AbortController();
    const fail = (error: Error) => {
      if (listeners.signal.aborted) return;
      abort.abort(error);
      lifetime.abort(error);
    };
    void once(worker, "exit", { signal: listeners.signal }).then(
      ([code]) =>
        fail(new Error(`Scraper worker exited unexpectedly (code ${code})`)),
      fail,
    );
    const api = wrap<ScraperWorkerApi>(port1);
    const endpointClosed = once(port1, "close", { signal: listeners.signal });
    resources.defer(async () => {
      try {
        api[releaseProxy]();
      } catch (error) {
        port1.close();
        throw error;
      } finally {
        await endpointClosed;
      }
    });
    const rpc = <T>(call: Promise<T>) =>
      Promise.race([
        call,
        aborted(lifetime.signal, worker).then((): never => {
          throw lifetime.signal.reason;
        }),
      ]);
    const cancel = (reason = new Error("Scraper worker cancelled")) => {
      if (abort.signal.aborted) return;
      abort.abort(reason);
      void rpc(api.cancel()).catch(fail);
    };
    const { promise: callbacksReleased, resolve: released } =
      Promise.withResolvers<void>();
    const scrapingResult = api.scrape(
      settings,
      proxy({
        timing: async (timing: RunTiming) => {
          if (timing.endedAt === undefined)
            activeTimings.set(timing.id, timing);
          else activeTimings.delete(timing.id);
          await onTiming?.(timing);
        },
        status: async (status: string[], totalTime?: number) => {
          await onStatus?.(status, totalTime);
        },
        warning: async (error: unknown, caller: string) => {
          await onError?.(error, caller);
        },
        otp: async (accountIndex: number) => {
          const account =
            Number.isInteger(accountIndex) && accountIndex >= 0
              ? scraping.accounts[accountIndex]
              : undefined;
          if (
            !settings.enableOtp ||
            !account ||
            account.companyId !== "oneZero" ||
            !("phoneNumber" in account) ||
            typeof account.phoneNumber !== "string" ||
            "otpLongTermToken" in account
          ) {
            throw new Error("Invalid scraper worker OTP request");
          }
          return requestOtpCode(
            account.companyId,
            account.phoneNumber,
            abort.signal,
          );
        },
        [finalizer]: released,
      }),
    );
    resources.defer(async () => {
      abort.abort(new Error("Scraper worker stopped"));
      if (lifetime.signal.aborted) return;
      await rpc(api.cancel());
      await rpc(callbacksReleased);
    });
    if (signal) {
      resources.use(addAbortListener(signal, () => cancel(signal.reason)));
    }
    const result = await Promise.race([
      rpc(scrapingResult),
      aborted(abort.signal, worker),
    ]);
    if (!result || abort.signal.aborted) throw abort.signal.reason;
    await resources.disposeAsync();
    return result;
  } catch (error) {
    await resources.disposeAsync().catch((cleanup: unknown) => {
      throw new SuppressedError(cleanup, error);
    });
    throw error;
  } finally {
    // Termination may prevent active accounts from sending their final update.
    const endedAt = Date.now();
    for (const timing of activeTimings.values()) {
      await onTiming?.({ ...timing, endedAt, failed: true });
    }
  }
}
