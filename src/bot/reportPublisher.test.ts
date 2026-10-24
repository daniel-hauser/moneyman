import { jest } from "@jest/globals";
import { ReportPublisher, type ReportTransport } from "./reportPublisher.js";
import { createRunReport, type RunReport } from "./runReport.js";

const render = (r: RunReport) => r.scrape.status.join(",");

function setup(intervalMs = 500, isTruncated = (_: RunReport) => false) {
  const log = jest.fn();
  const transport = {
    send: jest.fn<ReportTransport["send"]>().mockResolvedValue(7),
    edit: jest.fn<ReportTransport["edit"]>().mockResolvedValue(undefined),
    sendFile: jest
      .fn<ReportTransport["sendFile"]>()
      .mockResolvedValue(undefined),
  };
  const publisher = new ReportPublisher(createRunReport(), {
    transport,
    intervalMs,
    render,
    isTruncated,
    renderFull: (r) => `full:${render(r)}`,
    log,
  });
  const set = (...status: string[]) =>
    publisher.update((r) => {
      r.scrape.status = status;
    });
  return { transport, publisher, set, log };
}

describe("ReportPublisher", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("sends the first message then edits it", async () => {
    const { transport, set } = setup();
    set("a");
    await jest.advanceTimersByTimeAsync(0);
    expect(transport.send).toHaveBeenCalledWith("a");
    set("b");
    await jest.advanceTimersByTimeAsync(500);
    expect(transport.edit).toHaveBeenCalledWith(7, "b");
  });

  it("throttles and coalesces updates", async () => {
    const { transport, set } = setup();
    set("a");
    await jest.advanceTimersByTimeAsync(0);
    set("b");
    set("c");
    set("d");
    await jest.advanceTimersByTimeAsync(100);
    expect(transport.edit).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(400);
    expect(transport.edit).toHaveBeenCalledTimes(1);
    expect(transport.edit).toHaveBeenCalledWith(7, "d");
  });

  it("skips edits when the text is unchanged", async () => {
    const { transport, set } = setup();
    set("a");
    await jest.advanceTimersByTimeAsync(0);
    set("a");
    await jest.advanceTimersByTimeAsync(2000);
    expect(transport.edit).not.toHaveBeenCalled();
  });

  it("serializes requests", async () => {
    const { transport, set } = setup(10);
    let release!: () => void;
    transport.send.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve(7))),
    );
    set("a");
    await jest.advanceTimersByTimeAsync(0);
    set("b");
    await jest.advanceTimersByTimeAsync(1000);
    expect(transport.edit).not.toHaveBeenCalled();
    release();
    await jest.advanceTimersByTimeAsync(10);
    expect(transport.edit).toHaveBeenCalledWith(7, "b");
  });

  it("waits retry_after on 429 and renders the latest state", async () => {
    const { transport, set } = setup();
    set("a");
    await jest.advanceTimersByTimeAsync(0);
    transport.edit.mockRejectedValueOnce({
      response: { error_code: 429, parameters: { retry_after: 3 } },
    });
    set("b");
    await jest.advanceTimersByTimeAsync(500);
    expect(transport.edit).toHaveBeenCalledTimes(1);
    set("c");
    await jest.advanceTimersByTimeAsync(2900);
    expect(transport.edit).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(200);
    expect(transport.edit).toHaveBeenCalledTimes(2);
    expect(transport.edit).toHaveBeenLastCalledWith(7, "c");
  });

  it("ignores 'message is not modified'", async () => {
    const { transport, set } = setup();
    set("a");
    await jest.advanceTimersByTimeAsync(0);
    transport.edit.mockRejectedValueOnce({
      response: {
        error_code: 400,
        description: "Bad Request: message is not modified",
      },
    });
    set("b");
    await jest.advanceTimersByTimeAsync(5000);
    expect(transport.edit).toHaveBeenCalledTimes(1);
  });

  it("flush publishes the latest state immediately", async () => {
    const { transport, publisher, set } = setup();
    set("a");
    await jest.advanceTimersByTimeAsync(0);
    set("final");
    await publisher.flush();
    expect(transport.edit).toHaveBeenCalledWith(7, "final");
  });

  it("flush sends a pending first message", async () => {
    const { transport, publisher, set } = setup();
    set("only");
    await publisher.flush();
    expect(transport.send).toHaveBeenCalledWith("only");
  });

  it("is a no-op without a transport but still mutates the report", async () => {
    const publisher = new ReportPublisher(createRunReport(), { render });
    publisher.update((r) => {
      r.scrape.status = ["x"];
    }, "log line");
    await publisher.flush();
    expect(publisher.report.scrape.status).toEqual(["x"]);
  });

  it("does not reject when render throws, and recovers later", async () => {
    const { transport, publisher, set } = setup();
    const publisherWithBadRender = new ReportPublisher(createRunReport(), {
      transport,
      intervalMs: 500,
      render: () => {
        throw new Error("bad render");
      },
    });
    publisherWithBadRender.update(() => {});
    await jest.advanceTimersByTimeAsync(0);
    await expect(publisherWithBadRender.flush()).resolves.toBeUndefined();
    expect(transport.send).not.toHaveBeenCalled();

    set("fine");
    await expect(publisher.flush()).resolves.toBeUndefined();
    expect(transport.send).toHaveBeenCalledWith("fine");
  });

  it("flush drains updates that arrive while the pump is finishing", async () => {
    const { transport, publisher, set } = setup(10);
    transport.send.mockImplementationOnce(async () => {
      // lands while the pump is wrapping up
      set("b");
      return 7;
    });
    set("a");
    const flushing = publisher.flush();
    await flushing;
    expect(transport.edit).toHaveBeenLastCalledWith(7, "b");
  });

  it("gives up after repeated 429s so flush does not block forever", async () => {
    const { transport, publisher, set } = setup();
    set("a");
    await publisher.flush();
    transport.edit.mockRejectedValue({
      response: { error_code: 429, parameters: { retry_after: 1 } },
    });
    set("b");
    const flushing = publisher.flush();
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(flushing).resolves.toBeUndefined();
    expect(transport.edit).toHaveBeenCalledTimes(4);
  });

  describe("stats", () => {
    it("counts bursts, coalescing, unchanged frames and a 429", async () => {
      const { transport, publisher, set, log } = setup();
      set("a");
      await jest.advanceTimersByTimeAsync(0);
      // burst of 5 updates -> one request
      for (const v of ["b", "c", "d", "e", "f"]) set(v);
      await jest.advanceTimersByTimeAsync(500);
      // unchanged
      set("f");
      await jest.advanceTimersByTimeAsync(500);
      // one 429
      transport.edit.mockRejectedValueOnce({
        response: { error_code: 429, parameters: { retry_after: 2 } },
      });
      set("g");
      await jest.advanceTimersByTimeAsync(500);
      await jest.advanceTimersByTimeAsync(2000);
      await publisher.finish();

      expect(publisher.getStats()).toMatchObject({
        updateCalls: 8,
        sendCount: 1,
        editCount: 2,
        requestsSent: 3,
        skippedUnchanged: 1,
        // 5-update burst folds into one request (4 coalesced) + 1 skipped
        coalescedUpdates: 5,
        maxUpdatesPerRequest: 5,
        maxUpdatesPerSecond: 7,
        rateLimited: 1,
        totalRetryAfterMs: 2000,
        droppedAfterRetries: 0,
        failures: 0,
        renderErrors: 0,
        fileSent: false,
        fileAttempts: 0,
      });
      expect(publisher.getStats().throttleWaits).toBeGreaterThan(0);

      await publisher.finish();
      const statsLines = log.mock.calls.filter(([m]) =>
        String(m).startsWith("report stats "),
      );
      expect(statsLines).toHaveLength(1);
      expect(JSON.parse(String(statsLines[0][0]).slice(13)).updateCalls).toBe(
        8,
      );
    });

    it("tracks truncated frames, file attempts and failures", async () => {
      const { transport, publisher, set } = setup(500, () => true);
      transport.send.mockRejectedValueOnce(new Error("net"));
      set("a");
      await publisher.flush();
      set("b");
      await publisher.finish();
      expect(publisher.getStats()).toMatchObject({
        failures: 1,
        truncatedFrames: 2,
        fileSent: true,
        fileAttempts: 1,
      });
    });

    it("still logs stats without a transport", async () => {
      const log = jest.fn();
      const publisher = new ReportPublisher(createRunReport(), { log });
      publisher.update(() => {});
      await publisher.finish();
      expect(publisher.getStats().updateCalls).toBe(1);
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^report stats /));
    });
  });

  describe("status.txt", () => {
    it("sends the full final report once if any published frame was truncated", async () => {
      const { transport, publisher, set } = setup(500, (r) =>
        r.scrape.status.includes("long"),
      );
      set("long");
      await jest.advanceTimersByTimeAsync(0);
      set("short");
      await publisher.flush();
      await publisher.sendFullReportIfTruncated();
      await publisher.sendFullReportIfTruncated();
      expect(transport.sendFile).toHaveBeenCalledTimes(1);
      expect(transport.sendFile).toHaveBeenCalledWith(
        "status.txt",
        "full:short",
      );
    });

    it("retries a failed upload and marks it sent only after success", async () => {
      const { transport, publisher, set } = setup(500, () => true);
      transport.sendFile
        .mockRejectedValueOnce(new Error("net"))
        .mockResolvedValueOnce(undefined);
      set("a");
      await publisher.flush();
      const sending = publisher.sendFullReportIfTruncated();
      await jest.advanceTimersByTimeAsync(5000);
      await sending;
      expect(transport.sendFile).toHaveBeenCalledTimes(2);
      await publisher.sendFullReportIfTruncated();
      expect(transport.sendFile).toHaveBeenCalledTimes(2);
    });

    it("stops after a bounded number of failed uploads", async () => {
      const { transport, publisher, set } = setup(500, () => true);
      transport.sendFile.mockRejectedValue(new Error("net"));
      set("a");
      await publisher.flush();
      const sending = publisher.sendFullReportIfTruncated();
      await jest.advanceTimersByTimeAsync(10_000);
      await sending;
      expect(transport.sendFile).toHaveBeenCalledTimes(3);
    });

    it("does not send a file when nothing was truncated", async () => {
      const { transport, publisher, set } = setup();
      set("a");
      await publisher.flush();
      await publisher.sendFullReportIfTruncated();
      expect(transport.sendFile).not.toHaveBeenCalled();
    });

    it("is a no-op without a transport", async () => {
      const publisher = new ReportPublisher(createRunReport(), {
        render,
        isTruncated: () => true,
      });
      publisher.update(() => {});
      await publisher.flush();
      await expect(
        publisher.sendFullReportIfTruncated(),
      ).resolves.toBeUndefined();
    });
  });
});
