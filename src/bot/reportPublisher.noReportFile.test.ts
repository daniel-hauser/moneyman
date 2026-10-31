import { jest } from "@jest/globals";
import type { ReportTransport } from "./reportPublisher.js";

jest.mock("./runReport.js", () => ({
  ...jest.requireActual<typeof import("./runReport.js")>("./runReport.js"),
  renderHTMLReport: jest.fn(() => "<html>report</html>"),
}));

type PublisherModule = typeof import("./reportPublisher.js");
type RunReportModule = typeof import("./runReport.js");

let createReportPublisher: PublisherModule["createReportPublisher"];
let createRunReport: RunReportModule["createRunReport"];
let renderHTMLReport: jest.MockedFunction<RunReportModule["renderHTMLReport"]>;

beforeAll(async () => {
  ({ createReportPublisher } = await import("./reportPublisher.js"));
  ({ createRunReport } = await import("./runReport.js"));
  renderHTMLReport = jest.mocked(
    (await import("./runReport.js")).renderHTMLReport,
  );
});

const tick = (ms: number) => jest.advanceTimersByTimeAsync(ms);

function setup(withSendFile: boolean) {
  const log = jest.fn();
  const send = jest.fn<ReportTransport["send"]>().mockResolvedValue(7);
  const edit = jest.fn<ReportTransport["edit"]>().mockResolvedValue(undefined);
  const sendFile = jest
    .fn<NonNullable<ReportTransport["sendFile"]>>()
    .mockResolvedValue(undefined);
  const transport: ReportTransport = {
    send,
    edit,
    ...(withSendFile ? { sendFile } : {}),
  };
  const { report, finish } = createReportPublisher(createRunReport(), {
    transport,
    intervalMs: 500,
    log,
  });
  return { report, finish, send, edit, sendFile, log };
}

describe("createReportPublisher report.html gate", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    renderHTMLReport.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it("sends and renders report.html when sendFile is available", async () => {
    const { report, finish, sendFile } = setup(true);
    report.scrape.status = ["done"];
    const done = finish();
    await tick(0);
    await done;
    expect(renderHTMLReport).toHaveBeenCalledTimes(1);
    expect(sendFile).toHaveBeenCalledTimes(1);
    expect(sendFile.mock.calls[0][0]).toBe("report.html");
  });

  it("neither sends nor renders report.html when sendFile is omitted", async () => {
    const { report, finish, send, edit, log } = setup(false);
    report.scrape.status = ["done"];
    const done = finish();
    await tick(0);
    await done;
    expect(renderHTMLReport).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
    expect(log.mock.calls.map(([message]) => String(message))).not.toContain(
      "Sending report.html",
    );
    expect(
      log.mock.calls.filter(([message]) =>
        String(message).startsWith("report stats"),
      ),
    ).toHaveLength(1);
  });
});
