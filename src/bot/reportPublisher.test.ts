import { jest } from "@jest/globals";
import { ReportPublisher, type ReportTransport } from "./reportPublisher.js";
import { createRunReport, type RunReport } from "./runReport.js";

const render = (r: RunReport) => r.scrape.status.join(",");

function setup(intervalMs = 500) {
  const transport = {
    send: jest.fn<ReportTransport["send"]>().mockResolvedValue(7),
    edit: jest.fn<ReportTransport["edit"]>().mockResolvedValue(undefined),
  };
  const publisher = new ReportPublisher(createRunReport(), {
    transport,
    intervalMs,
    render,
  });
  const set = (...status: string[]) =>
    publisher.update((r) => {
      r.scrape.status = status;
    });
  return { transport, publisher, set };
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
});
