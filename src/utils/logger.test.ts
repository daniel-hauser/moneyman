import debug from "debug";
import { createLogger } from "./logger.js";
import { loggerContextStore } from "./asyncContext.js";

const mockThread = { isMainThread: true, threadId: 0 };

jest.mock("node:worker_threads", () => ({
  get isMainThread() {
    return mockThread.isMainThread;
  },
  get threadId() {
    return mockThread.threadId;
  },
}));

describe("debug logger thread scopes", () => {
  let write: jest.SpiedFunction<typeof process.stderr.write>;
  let debugFilter: string;

  const output = () =>
    write.mock.calls.map(([chunk]) => String(chunk)).join("");

  beforeEach(() => {
    mockThread.isMainThread = true;
    mockThread.threadId = 0;
    write = jest.spyOn(process.stderr, "write").mockReturnValue(true);
    debugFilter = debug.disable();
    debug.enable("moneyman:*");
  });

  afterEach(() => {
    debug.enable(debugFilter);
    write.mockRestore();
  });

  it.each([
    [true, 0, "[main]"],
    [false, 4, "[worker 4]"],
  ])("labels thread %s/%s as %s", (isMainThread, threadId, scope) => {
    Object.assign(mockThread, { isMainThread, threadId });
    const logger = createLogger("scraper");

    logger("scraping %d accounts", 2);

    expect(logger.namespace).toBe("moneyman:scraper");
    expect(output()).toContain(scope);
    expect(output()).toContain("scraping 2 accounts");
  });

  it("preserves company and account context inside the worker scope", () => {
    Object.assign(mockThread, { isMainThread: false, threadId: 7 });

    loggerContextStore.run({ prefix: "[#0 oneZero]" }, () => {
      createLogger("scraper")("started");
    });

    expect(output()).toContain("[worker 7] [#0 oneZero]");
    expect(output()).toContain("started");
  });

  it("adds the scope when logging a non-string value", () => {
    debug.log({ message: "failure" });

    expect(output()).toContain("[main]");
    expect(output()).toContain("failure");
  });

  it("preserves existing namespace filters", () => {
    debug.enable("moneyman:scraper");

    createLogger("scraper")("included");
    createLogger("other")("excluded");

    expect(output()).toContain("[main]");
    expect(output()).toContain("included");
    expect(output()).not.toContain("excluded");
  });
});
