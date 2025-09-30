/**
 * Creates a promise that rejects when an AbortSignal is aborted
 * @param signal - AbortSignal to listen to
 * @param errorMessage - Error message to use when signal is aborted
 * @returns A promise that rejects when the signal is aborted
 */
export function waitForAbortSignal(
  signal: AbortSignal,
  errorMessage: string,
): Promise<never> {
  return new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(new Error(errorMessage));
      },
      { once: true },
    );
  });
}
