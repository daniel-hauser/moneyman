import debug from "debug";
import { createLogger } from "./logger.js";
import { privateLogExporter } from "./telemetry.js";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";

describe("structured debug bridge", () => {
  let records: ReadableLogRecord[];
  let filter: string;
  beforeEach(() => {
    records = [];
    filter = debug.disable();
    debug.enable("moneyman:*");
    jest
      .spyOn(privateLogExporter, "export")
      .mockImplementation((batch, done) => {
        records.push(...batch);
        done({ code: ExportResultCode.SUCCESS });
      });
  });
  afterEach(() => {
    debug.enable(filter);
    jest.restoreAllMocks();
  });
  it("keeps messages separate from namespace and thread resource metadata", () => {
    const logger = createLogger("scraper");
    logger("scraping %d accounts\nnext line", 2);
    expect(logger.namespace).toBe("moneyman:scraper");
    expect(records).toHaveLength(1);
    expect(records[0].body).toBe("scraping 2 accounts\nnext line");
    expect(records[0].attributes).toEqual({
      "log.namespace": "moneyman:scraper",
    });
    expect(records[0].resource.attributes).toMatchObject({
      "thread.id": 0,
      "thread.name": "main",
    });
  });
  it("preserves non-string diagnostics and namespace filters", () => {
    debug.enable("moneyman:scraper");
    createLogger("scraper")({ message: "failure" });
    createLogger("other")("excluded");
    expect(records).toHaveLength(1);
    expect(records[0].body).toContain("failure");
    expect(records[0].body).not.toContain("excluded");
  });
});
