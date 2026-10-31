import { jest } from "@jest/globals";
import {
  createReportPublisher,
  type ReportTransport,
} from "./reportPublisher.js";
import { createRunReport } from "./runReport.js";

function setup(intervalMs = 500) {
  const log = jest.fn();
  const transport = {
    send: jest.fn<ReportTransport["send"]>().mockResolvedValue(7),
    edit: jest.fn<ReportTransport["edit"]>().mockResolvedValue(undefined),
    sendFile: jest
      .fn<ReportTransport["sendFile"]>()
      .mockResolvedValue(undefined),
  };
  const { report, finish } = createReportPublisher(createRunReport(), {
    transport,
    intervalMs,
    log,
  });
  const set = (...status: string[]) => {
    report.scrape.status = status;
  };
  return { transport, report, finish, set, log };
}

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

describe("createReportPublisher", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("sends the first message, then edits it on nested mutations", async () => {
    const { transport, report, set } = setup();
    set("a");
    await tick(0);
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(transport.send.mock.calls[0][0]).toContain("a");

    report.storages["Sheets"] = { state: "saving", steps: [] };
    await tick(500);
    expect(transport.edit).toHaveBeenCalledTimes(1);
    expect(transport.edit.mock.calls[0][1]).toContain("Sheets");

    report.notices.push("note");
    await tick(500);
    expect(transport.edit.mock.calls[1][1]).toContain("note");
  });

  it("throttles and coalesces updates, rendering the latest", async () => {
    const { transport, set } = setup();
    set("a");
    await tick(0);
    set("b");
    set("c");
    set("d");
    await tick(100);
    expect(transport.edit).not.toHaveBeenCalled();
    await tick(400);
    expect(transport.edit).toHaveBeenCalledTimes(1);
    expect(transport.edit.mock.calls[0][1]).toContain("d");
  });

  it("skips the request when the text is unchanged", async () => {
    const { transport, set } = setup();
    set("a");
    await tick(0);
    set("b");
    set("a");
    await tick(500);
    expect(transport.edit).not.toHaveBeenCalled();
  });

  it("treats 'message is not modified' as success", async () => {
    const { transport, set, log } = setup();
    transport.send.mockRejectedValueOnce({
      response: {
        error_code: 400,
        description: "Bad Request: message is not modified: foo",
      },
    });
    set("a");
    await tick(0);
    expect(log).not.toHaveBeenCalled();
    set("a");
    await tick(500);
    expect(transport.send).toHaveBeenCalledTimes(1);
  });

  it("waits for retry_after on 429 and then renders the latest", async () => {
    const { transport, set } = setup();
    set("a");
    await tick(0);
    transport.edit.mockRejectedValueOnce({
      response: { error_code: 429, parameters: { retry_after: 3 } },
    });
    set("b");
    await tick(500);
    expect(transport.edit).toHaveBeenCalledTimes(1);
    set("c");
    await tick(2000);
    expect(transport.edit).toHaveBeenCalledTimes(1);
    await tick(1001);
    expect(transport.edit).toHaveBeenCalledTimes(2);
    expect(transport.edit.mock.calls[1][1]).toContain("c");
  });

  it("logs and survives other failures", async () => {
    const { transport, set, log, finish } = setup();
    transport.send.mockRejectedValueOnce(new Error("network"));
    set("a");
    await tick(0);
    expect(log).toHaveBeenCalledWith(
      "Failed to publish report",
      expect.any(Error),
    );
    set("b");
    const done = finish();
    await tick(1000);
    await done;
    expect(transport.send).toHaveBeenCalledTimes(2);
  });

  it("flushes the latest state at finish and logs stats once", async () => {
    const { transport, set, finish, log } = setup();
    set("a");
    await tick(0);
    set("b");
    const done = finish();
    await tick(500);
    await done;
    expect(transport.edit.mock.calls.at(-1)![1]).toContain("b");
    expect(transport.sendFile).toHaveBeenCalledTimes(1);
    expect(transport.sendFile.mock.calls[0][0]).toBe("report.html");
    const statsLines = log.mock.calls.filter(([m]) =>
      String(m).startsWith("report stats"),
    );
    expect(statsLines).toHaveLength(1);
  });

  it("sends one complete report.html at finish", async () => {
    const { transport, report, finish } = setup();
    report.storages["Sheets"] = { state: "error", message: "x".repeat(1000) };
    const done = finish();
    await tick(500);
    await done;
    expect(transport.sendFile).toHaveBeenCalledTimes(1);
    expect(transport.sendFile.mock.calls[0][0]).toBe("report.html");
    expect(transport.sendFile.mock.calls[0][1]).toContain("x".repeat(1000));
    expect(transport.sendFile.mock.calls[0][1]).toContain("❌ Failed");
  });

  it("includes logs only in the final HTML attachment, not the text summary", async () => {
    const { transport, finish } = setup();
    const done = finish("captured <log>");
    await tick(500);
    await done;

    expect(transport.sendFile).toHaveBeenCalledTimes(1);
    expect(transport.sendFile.mock.calls[0][1]).toContain(
      "captured &lt;log&gt;",
    );
    expect(transport.send.mock.calls[0][0]).not.toContain("captured");
    expect(transport.edit).not.toHaveBeenCalled();
  });

  it("does nothing without a transport", async () => {
    const { report, finish } = createReportPublisher(createRunReport());
    report.scrape.status = ["a"];
    await expect(finish()).resolves.toBe(false);
  });
});
