import { waitForAbortSignal } from "./promises.js";

describe("promises utilities", () => {
  describe("waitForAbortSignal", () => {
    it("should reject when signal is aborted", async () => {
      const controller = new AbortController();

      const promise = waitForAbortSignal(controller.signal);

      // Verify the promise is pending before aborting
      const isPending = await Promise.race([
        promise.then(
          () => false,
          () => false,
        ),
        Promise.resolve(true),
      ]);
      expect(isPending).toBe(true);

      controller.abort();

      await expect(promise).rejects.toThrow(controller.signal.reason);
    });

    it("should only reject once even if abort is called multiple times", async () => {
      const controller = new AbortController();
      const testError = new Error("Test error");

      const promise = waitForAbortSignal(controller.signal);

      controller.abort(testError);
      controller.abort(new Error("Another error"));

      await expect(promise).rejects.toBe(testError);
    });
  });
});
