/**
 * Creates a promise that rejects when an AbortSignal is aborted
 * @param signal - AbortSignal to listen to
 * @returns A promise that rejects when the signal is aborted
 */
export function waitForAbortSignal(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
