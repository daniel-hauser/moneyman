import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { aborted } from "node:util";
import { mockDeep } from "jest-mock-extended";
import type { Page } from "puppeteer";
import { solveTurnstile } from "./cloudflareSolver.js";

const log = jest.fn();
jest.mock("../utils/logger.js", () => ({
  createLogger:
    () =>
    (...args: unknown[]) =>
      log(...args),
}));

function setup() {
  const page = mockDeep<Page>();
  const events = new EventEmitter();
  page.once.mockImplementation((event, listener) => {
    events.once(String(event), listener);
    return page;
  });
  page.off.mockImplementation((event, listener) => {
    if (listener) events.off(String(event), listener);
    return page;
  });
  page.isClosed.mockReturnValue(false);
  return {
    page,
    events,
    close() {
      page.isClosed.mockReturnValue(true);
      events.emit("close");
    },
  };
}

describe("solveTurnstile", () => {
  beforeEach(() => {
    log.mockClear();
    jest.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([
    ["mouse movement", 0.5],
    ["checkbox pause", 0],
  ] as const)("stops during %s when the page closes", async (_, random) => {
    jest.useFakeTimers();
    jest.mocked(Math.random).mockReturnValue(random);
    const { page, events, close } = setup();
    const solving = solveTurnstile(page);
    await setImmediate();
    expect(page.mouse.move).toHaveBeenCalled();
    const moves = page.mouse.move.mock.calls.length;
    expect(jest.getTimerCount()).toBe(1);

    close();

    expect(jest.getTimerCount()).toBe(0);
    await expect(solving).resolves.toBe("page closed");
    expect(page.mouse.move).toHaveBeenCalledTimes(moves);
    expect(page.mouse.click).not.toHaveBeenCalled();
    expect(page.waitForNavigation).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalledWith(
      "solveTurnstile error",
      expect.anything(),
    );
    expect(events.listenerCount("close")).toBe(0);
  });

  it("returns normally for an already closed page without starting work", async () => {
    const { page, events, close } = setup();
    close();

    await expect(solveTurnstile(page)).resolves.toBe("page closed");

    expect(page.evaluate).not.toHaveBeenCalled();
    expect(page.mouse.move).not.toHaveBeenCalled();
    expect(events.listenerCount("close")).toBe(0);
  });

  it("removes the close listener after repeated failures without hiding errors", async () => {
    const { page, events } = setup();
    const error = new Error("invented evaluation failure");
    page.evaluate.mockRejectedValue(error);

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(solveTurnstile(page)).resolves.toBe(
        "failed to solve: Error: invented evaluation failure",
      );
      expect(events.listenerCount("close")).toBe(0);
    }
    expect(log).toHaveBeenCalledWith("solveTurnstile error", error);
  });

  it("still clicks and navigates successfully, then removes the close listener", async () => {
    const { page, events } = setup();

    await expect(solveTurnstile(page)).resolves.toBe("success");

    expect(page.mouse.click).toHaveBeenCalledTimes(1);
    expect(page.waitForNavigation).toHaveBeenCalledWith({
      timeout: 60_000,
      signal: expect.any(AbortSignal),
    });
    expect(events.listenerCount("close")).toBe(0);
  });

  it("cancels the native navigation wait when the page closes", async () => {
    jest.useFakeTimers();
    const { page, events, close } = setup();
    page.waitForNavigation.mockImplementation(async ({ signal } = {}) => {
      if (!signal) throw new Error("Missing navigation cancellation signal");
      await aborted(signal, page);
      signal.throwIfAborted();
      return null;
    });
    const solving = solveTurnstile(page);
    await jest.advanceTimersByTimeAsync(1500);
    expect(page.waitForNavigation).toHaveBeenCalledTimes(1);

    close();

    await expect(solving).resolves.toBe("page closed");
    expect(events.listenerCount("close")).toBe(0);
  });
});
