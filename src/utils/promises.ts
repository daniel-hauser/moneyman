/**
 * Creates a promise that rejects when an AbortSignal times out
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Error message to use when timeout occurs
 * @returns A promise that rejects when the timeout occurs
 */
export function createTimeoutPromise(
  timeoutMs: number,
  errorMessage: string,
): Promise<never> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  return new Promise<never>((_, reject) => {
    timeoutSignal.addEventListener(
      "abort",
      () => {
        reject(new Error(errorMessage));
      },
      { once: true },
    );
  });
}
