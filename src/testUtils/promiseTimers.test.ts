import { getEventListeners } from "node:events";
import {
  scheduler,
  setImmediate,
  setInterval,
  setTimeout,
} from "node:timers/promises";

jest.mock("node:timers/promises", () =>
  jest
    .requireActual<typeof import("./promiseTimers.js")>("./promiseTimers.js")
    .createPromiseTimerMock(),
);

describe("opt-in promise timer mock", () => {
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
    });
    controller.abort("during");
    await rejection;
    expect(jest.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("also works with real timers and preserves other exports", async () => {
    const timerSpy = jest.spyOn(globalThis, "setTimeout");
    const result = setTimeout(1, "real", { ref: false });
    expect(timerSpy.mock.results[0].value.hasRef()).toBe(false);
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
});
