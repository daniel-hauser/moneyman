import { getEventListeners } from "node:events";
import {
  scheduler,
  setImmediate,
  setInterval,
  setTimeout,
} from "node:timers/promises";

describe("automatic promise timer support", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("uses fake time and resolves with the supplied value", async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const result = setTimeout(100, "value", { signal: controller.signal });
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe("value");
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("rejects without scheduling when already aborted", async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    controller.abort("before");
    await expect(
      setTimeout(100, undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
      code: "ABORT_ERR",
      cause: "before",
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it("clears the timer and listener when aborted while waiting", async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const result = setTimeout(100, undefined, {
      signal: controller.signal,
      ref: false,
    });
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
      code: "ABORT_ERR",
      cause: "during",
      message: "The operation was aborted",
    });
    controller.abort("during");
    await rejection;
    expect(jest.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("uses the native abort error even when propagation is stopped", async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    controller.signal.addEventListener("abort", (event) =>
      event.stopImmediatePropagation(),
    );
    const result = setTimeout(100, undefined, { signal: controller.signal });
    const rejection = result.catch((error: unknown) => error);
    controller.abort("reason");
    const actual = jest.requireActual<typeof import("node:timers/promises")>(
      "node:timers/promises",
    );
    const nativeError = await actual
      .setTimeout(1, undefined, { signal: controller.signal })
      .then(
        () => {
          throw new Error("expected native timeout to reject");
        },
        (error: Error) => error,
      );
    const error = await rejection;
    expect(error).toBeInstanceOf(nativeError.constructor);
    expect(error).toMatchObject({ code: "ABORT_ERR", cause: "reason" });
    expect(jest.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
  });

  it("supports legacy fake timers without per-test registration", async () => {
    jest.useFakeTimers({ legacyFakeTimers: true });
    const result = setTimeout(100, "legacy", { ref: false });
    jest.advanceTimersByTime(100);
    await expect(result).resolves.toBe("legacy");
  });

  it("still detects fake timers when setTimeout is spied on", async () => {
    jest.useFakeTimers();
    const timerSpy = jest.spyOn(globalThis, "setTimeout");
    const result = setTimeout(100, "spied", { ref: false });
    expect(timerSpy.mock.results[0].value.hasRef()).toBe(false);
    await jest.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe("spied");
  });

  it("also works with real timers and preserves other exports", async () => {
    const timerSpy = jest.spyOn(globalThis, "setTimeout");
    const result = setTimeout(1, "real", { ref: false });
    expect(timerSpy).not.toHaveBeenCalled();
    timerSpy.mockRestore();
    const keepAlive = new Promise((resolve) =>
      globalThis.setTimeout(resolve, 5),
    );
    await expect(result).resolves.toBe("real");
    await keepAlive;
    const actual = jest.requireActual<typeof import("node:timers/promises")>(
      "node:timers/promises",
    );
    expect(setImmediate).toBe(actual.setImmediate);
    expect(setInterval).toBe(actual.setInterval);
    expect(scheduler).toBe(actual.scheduler);
  });

  it("uses native validation for invalid timer options under fake timers", async () => {
    jest.useFakeTimers();
    await expect(
      // @ts-expect-error Exercise invalid runtime input.
      setTimeout(1, undefined, { ref: "no" }),
    ).rejects.toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
    await expect(
      // @ts-expect-error Exercise invalid runtime input.
      setTimeout(1, undefined, { signal: null }),
    ).rejects.toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
    await expect(
      // @ts-expect-error Exercise invalid runtime input.
      setTimeout(1, undefined, { signal: { aborted: false } }),
    ).rejects.toThrow();
    expect(jest.getTimerCount()).toBe(0);
  });
});
