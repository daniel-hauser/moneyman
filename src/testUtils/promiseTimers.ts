/**
 * Opt-in timeout mock for tests using Jest fake timers.
 * https://github.com/jestjs/jest/issues/16392
 *
 * This supports the timeout value, signal and ref options used by our tests,
 * but is not a replacement for Node's argument validation or timer internals.
 */
export function createPromiseTimerMock() {
  const actual = jest.requireActual<typeof import("node:timers/promises")>(
    "node:timers/promises",
  );

  return {
    ...actual,
    setTimeout<T>(
      delay?: number,
      value?: T,
      options?: { signal?: AbortSignal; ref?: boolean },
    ): Promise<T> {
      const { signal, ref } = options ?? {};
      return new Promise((resolve, reject) => {
        const abortError = () =>
          Object.assign(
            new Error("The operation was aborted", { cause: signal?.reason }),
            {
              name: "AbortError",
              code: "ABORT_ERR",
            },
          );
        if (signal?.aborted) {
          reject(abortError());
          return;
        }

        const onAbort = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          reject(abortError());
        };
        const timer = globalThis.setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve(value as T);
        }, delay);
        if (ref === false) timer.unref();
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}
