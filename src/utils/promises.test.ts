import { waitForAbortSignal } from "./promises.js";

describe("promises utilities", () => {
  describe("waitForAbortSignal", () => {
    it("should reject when signal is aborted", async () => {
      const controller = new AbortController();
      const errorMessage = "Test abort error";

      const promise = waitForAbortSignal(controller.signal, errorMessage);

      controller.abort();

      await expect(promise).rejects.toThrow(errorMessage);
    });

    it("should reject with custom error message", async () => {
      const controller = new AbortController();
      const customMessage = "Custom abort message";

      const promise = waitForAbortSignal(controller.signal, customMessage);

      controller.abort();

      await expect(promise).rejects.toThrow(customMessage);
    });

    it("should work with AbortSignal.timeout", async () => {
      const timeoutMs = 50;
      const signal = AbortSignal.timeout(timeoutMs);
      const errorMessage = "Timeout occurred";

      const promise = waitForAbortSignal(signal, errorMessage);

      await expect(promise).rejects.toThrow(errorMessage);
    });

    it("should only reject once even if abort is called multiple times", async () => {
      const controller = new AbortController();
      const errorMessage = "Test error";
      let rejectCount = 0;

      const promise = waitForAbortSignal(controller.signal, errorMessage).catch(
        (error) => {
          rejectCount++;
          throw error;
        },
      );

      controller.abort();
      controller.abort();
      controller.abort();

      await expect(promise).rejects.toThrow(errorMessage);
      expect(rejectCount).toBe(1);
    });
  });
});
