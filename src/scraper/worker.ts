/// <reference lib="esnext.disposable" />
import {
  locks,
  threadId,
  workerData,
  type MessagePort,
} from "node:worker_threads";
import { expose, releaseProxy } from "comlink";
import debug from "debug";
import { scrapeAccounts } from "./index.js";
import { aborted } from "node:util";
import { createDomainTracker } from "../security/domains.js";
import { formatUnknownError } from "../utils/utils.js";
import { WorkerConfigSchema, type ScraperWorkerApi } from "./protocol.js";

function createScraperSession(): ScraperWorkerApi {
  const abort = new AbortController();
  const sessionLock = `moneyman.scraper.${threadId}`;
  const progressLock = `${sessionLock}.progress`;

  return {
    scrape(settings, callbacks) {
      return locks.request(sessionLock, { ifAvailable: true }, async (lock) => {
        const resources = new AsyncDisposableStack();
        resources.defer(() => callbacks[releaseProxy]());
        try {
          if (!lock) {
            abort.signal.throwIfAborted();
            throw new Error("Scraper worker already has a run in progress");
          }
          abort.signal.throwIfAborted();
          const scraping = WorkerConfigSchema.parse(settings);
          debug.enable(scraping.debugFilter);
          const domainTracker = createDomainTracker({
            domainTracking: scraping.domainTracking,
            firewallSettings: scraping.firewallSettings,
            blockByDefault: scraping.blockByDefault,
          });
          resources.defer(() => domainTracker.dispose());
          resources.defer(() => locks.request(progressLock, () => {}));
          const results = await scrapeAccounts(
            scraping,
            domainTracker.initDomainTracking,
            (status, totalTime) => {
              const rows = Array.from(status, (row) => row ?? "");
              return locks
                .request(progressLock, async () => {
                  try {
                    await callbacks.status(rows, totalTime);
                  } catch (error) {
                    // Fail before releasing the lock to a pending drain.
                    abort.abort(error);
                  }
                })
                .catch((error) => {
                  abort.abort(error);
                });
            },
            (error, caller) => callbacks.warning(error, caller),
            {
              executablePath: scraping.executablePath,
              signal: abort.signal,
              requestOtpCode: scraping.enableOtp
                ? async (companyId, phoneNumber) => {
                    abort.signal.throwIfAborted();
                    const completed = new AbortController();
                    const signal = AbortSignal.any([
                      abort.signal,
                      completed.signal,
                    ]);
                    try {
                      const response = await Promise.race([
                        callbacks.otp(
                          scraping.accounts.findIndex(
                            (account) =>
                              account.companyId === companyId &&
                              !("otpLongTermToken" in account) &&
                              "phoneNumber" in account &&
                              account.phoneNumber === phoneNumber,
                          ),
                        ),
                        aborted(signal, callbacks),
                      ]);
                      if (typeof response === "string") return response;
                      throw signal.reason;
                    } finally {
                      completed.abort();
                    }
                  }
                : undefined,
            },
          );
          abort.signal.throwIfAborted();
          const domains = await domainTracker.getUsedDomains();
          await resources.disposeAsync();
          abort.signal.throwIfAborted();
          return { results, domains };
        } catch (error) {
          await resources.disposeAsync().catch((cleanup: unknown) => {
            throw new SuppressedError(
              cleanup,
              error,
              `${formatUnknownError(error)}; cleanup failed: ${formatUnknownError(cleanup)}`,
            );
          });
          if (error instanceof SuppressedError) {
            // Comlink transfers Error metadata, not nested suppression details.
            error.message = formatUnknownError(error);
          }
          throw error;
        }
      });
    },
    async cancel() {
      abort.abort(new Error("Scraper worker cancelled"));
      await locks.request(sessionLock, () => {});
    },
  };
}

const session = createScraperSession();
const endpoint = workerData as MessagePort;
endpoint.once("close", () => {
  void session.cancel();
});
expose(session, endpoint);
