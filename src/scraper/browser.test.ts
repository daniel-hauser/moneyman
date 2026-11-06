import { mock } from "jest-mock-extended";
import puppeteer, { type Browser } from "puppeteer";
import { createBrowser } from "./browser.js";
import * as logging from "./puppeteerLogger.js";

jest.mock("puppeteer", () => ({
  __esModule: true,
  default: { launch: jest.fn() },
  TargetType: { PAGE: "page" },
}));
jest.mock("./puppeteerLogger.js", () => ({
  createPuppeteerLogger: jest.fn(
    jest.requireActual<typeof import("./puppeteerLogger.js")>(
      "./puppeteerLogger.js",
    ).createPuppeteerLogger,
  ),
}));

describe("browser logging lifetime", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("keeps ownership after returning and through cancellation until actual disconnect", async () => {
    const browser = mock<Browser>();
    jest.mocked(puppeteer.launch).mockResolvedValue(browser);
    const createLogger = jest.mocked(logging.createPuppeteerLogger);
    const cancellation = new AbortController();
    expect(await createBrowser(undefined, cancellation.signal)).toBe(browser);
    const lifetime = createLogger.mock.calls[0][0];
    expect(lifetime.aborted).toBe(false);
    expect(puppeteer.launch).toHaveBeenCalledWith(
      expect.objectContaining({ signal: cancellation.signal }),
    );
    cancellation.abort();
    expect(lifetime.aborted).toBe(false);
    expect(browser.once).toHaveBeenCalledWith(
      "disconnected",
      expect.any(Function),
    );
    browser.once.mock.calls[0][1](undefined);
    expect(lifetime.aborted).toBe(true);
  });

  it("cleans up ownership on rejected or cancelled launch", async () => {
    const createLogger = jest.mocked(logging.createPuppeteerLogger);
    jest
      .mocked(puppeteer.launch)
      .mockRejectedValue(new Error("invented launch failure"));
    await expect(createBrowser()).rejects.toThrow("invented launch failure");
    expect(createLogger.mock.calls[0][0].aborted).toBe(true);
    const cancellation = new AbortController();
    cancellation.abort(new Error("invented cancellation"));
    jest.mocked(puppeteer.launch).mockRejectedValue(cancellation.signal.reason);
    await expect(createBrowser(undefined, cancellation.signal)).rejects.toThrow(
      "invented cancellation",
    );
    expect(createLogger.mock.calls[1][0].aborted).toBe(true);
  });
});
