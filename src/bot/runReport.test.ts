/** @jest-environment ./report/test-environment.cjs */
import { Blob, Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { ReportLightElement } from "./report/light-element.js";
import { CompanyTypes } from "israeli-bank-scrapers";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";
import { AccountScrapeResult, type RunTiming } from "../types.js";
import { transaction } from "../utils/tests.js";
import { createSaveStats } from "./saveStats.js";
import { hashInlineContent } from "./report/html.js";
import {
  renderReportAccounts,
  renderReportStorages,
  renderReportScreenshots,
  renderReportTransactions,
  renderReportLogs,
  renderReportTimings,
} from "./report/components.js";
import {
  createRunReport,
  renderFullReport,
  renderHTMLReport,
  renderRunReport,
  TELEGRAM_MESSAGE_LIMIT,
  type RunReport,
} from "./runReport.js";

const startedAt = new Date("2024-01-01T10:00:00Z");

declare function createReportWindow(): Window & typeof globalThis;

async function runScripts(realm: Window & typeof globalThis, output: string) {
  for (const script of output.matchAll(/<script>([\s\S]*?)<\/script>/gi))
    realm.eval(script[1]);
  await Promise.all(
    Array.from(
      realm.document.querySelectorAll<ReportLightElement>(
        "report-transactions, report-logs",
      ),
      (element) => element.ready(),
    ),
  );
  await Promise.resolve();
}

afterEach(() => jest.restoreAllMocks());

function step(name: string, duration: number) {
  return { name, durationMs: duration };
}

function successResult(): AccountScrapeResult {
  return {
    companyId: CompanyTypes.max,
    result: {
      success: true,
      accounts: [
        {
          accountNumber: "1234",
          txns: [transaction({ description: "Shop" })],
        },
      ],
    },
  };
}

function baseReport(): RunReport {
  const report = createRunReport(startedAt);
  report.scrape = { status: ["max: scraping", "<b>visa</b>: done"] };
  return report;
}

function reportMarkup(output: string) {
  return output
    .replace(
      /<script>[\s\S]*?<\/script>/gi,
      "<script>[bundled report client]</script>",
    )
    .replace(/'sha256-[^']+'/g, "'sha256-[approved static asset]'");
}

describe("renderRunReport", () => {
  it("renders status rows while scraping", () => {
    expect(renderRunReport(baseReport())).toMatchSnapshot();
  });

  it("renders summary first and status in a collapsed quote", () => {
    const report = baseReport();
    report.scrape.totalTimeSec = 12.34;
    report.summary = { results: [successResult()] };
    expect(renderRunReport(report)).toMatchSnapshot();
  });

  it("renders storages in different states, each with its own quote", () => {
    const report = baseReport();
    report.summary = { results: [successResult()] };
    const tx = {
      ...transaction({}),
      hash: "h",
      uniqueId: "u",
      account: "a",
      companyId: CompanyTypes.max,
    };
    report.storages["Sheets"] = {
      state: "done",
      stats: createSaveStats("Sheets", "TheTable", [tx], {
        added: 1,
        existing: 1,
        pending: 1,
        otherSkipped: 1,
        highlightedTransactions: { Group1: [tx] },
      }),
      durationMs: 1234,
      steps: [step("Step1", 10), step("Step2", 1000)],
    };
    report.storages["YNAB"] = {
      state: "saving",
      steps: [step("Loading", 5)],
    };
    report.storages["Web"] = {
      state: "error",
      message: "boom",
    };
    const text = renderRunReport(report);
    expect(text).toMatchSnapshot();
  });

  it("renders notices", () => {
    const report = baseReport();
    report.notices.push("No transactions found, skipping save");
    expect(renderRunReport(report)).toMatchSnapshot();
  });

  it("truncates long errors before escaping", () => {
    const report = baseReport();
    report.summary = {
      results: [
        {
          companyId: CompanyTypes.max,
          result: {
            success: false,
            errorType: ScraperErrorTypes.Generic,
            errorMessage: `Unexpected token '<', "<!DOCTYPE "... is not valid JSON\nSyntaxError: Unexpected token\n    at JSON.parse (<anonymous>)`,
          },
        },
      ],
    };
    report.storages["Sheets"] = {
      state: "error",
      message: `${"<&>".repeat(300)}\n    at foo (bar.js:1:1)`,
    };
    const text = renderRunReport(report);
    expect(text).toMatchSnapshot();
  });

  it("renders all failed accounts", () => {
    const report = baseReport();
    report.summary = {
      results: Array.from({ length: 8 }, () => ({
        companyId: CompanyTypes.max,
        result: { success: false, errorType: ScraperErrorTypes.Generic },
      })),
    };
    const text = renderRunReport(report);
    expect(text).toMatchSnapshot();
  });

  it("never exceeds the Telegram limit", () => {
    const report = baseReport();
    report.summary = { results: [successResult()] };
    for (let i = 0; i < 400; i++) {
      report.storages[`Storage ${i}`] = {
        state: "saving",
        steps: [step("A step with a long name that takes space", 1)],
      };
    }
    const text = renderRunReport(report);
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(text.split("<blockquote").length).toBe(
      text.split("</blockquote>").length,
    );
    expect(text.slice(-120)).toMatchSnapshot();
  });
});

describe("renderFullReport", () => {
  it("equals the sent message when nothing is shortened", () => {
    const report = baseReport();
    report.summary = { results: [successResult()] };
    report.storages["Sheets"] = { state: "error", message: "boom" };
    const full = renderFullReport(report);
    expect(full).toMatchSnapshot();
    expect(renderRunReport(report)).toBe(full);
  });

  it("differs when errors are shortened or the limit is hit", () => {
    const report = baseReport();
    report.storages["Sheets"] = { state: "error", message: "x".repeat(1000) };
    expect({
      full: renderFullReport(report),
      sent: renderRunReport(report),
    }).toMatchSnapshot();

    const big = baseReport();
    for (let i = 0; i < 400; i++) {
      big.storages[`Storage ${i}`] = { state: "saving", steps: [] };
    }
    const full = renderFullReport(big);
    const sent = renderRunReport(big);
    expect({
      fullLength: full.length,
      sentLength: sent.length,
      fullEnd: full.slice(-80),
      sentEnd: sent.slice(-80),
    }).toMatchSnapshot();
  });
});

describe("screenshot file sizes", () => {
  it.each([
    ["exact decimal MB", Buffer.alloc(1_250_000).toString("base64"), "1.25 MB"],
    ["two padding bytes", "AA==", "<0.01 MB"],
    ["one padding byte", "AAA=", "<0.01 MB"],
    ["no padding", "AAAA", "<0.01 MB"],
    ["unpadded single byte", "AA", "<0.01 MB"],
    ["unpadded two bytes", "AAA", "<0.01 MB"],
    ["ASCII whitespace", " \tA\nA\f=\r= ", "<0.01 MB"],
    ["percent-encoded alphabet and padding", "%2B%2F8%3D", "<0.01 MB"],
    ["percent-encoded ASCII whitespace", "%20%09A%0AA%0C%3D%0D%3D", "<0.01 MB"],
    ["whitespace only", " \t\n\f\r", "0.00 MB"],
    ["percent-encoded empty", "%20%09%0A%0C%0D", "0.00 MB"],
    ["empty", "", "0.00 MB"],
  ])("renders decoded base64 size: %s", (_name, payload, expected) => {
    const dataUrl = `data:image/png;base64,${payload}`;
    const caption = 'Failure </figcaption><script>alert("hostile")</script> &';
    document.body.innerHTML = renderReportScreenshots([{ caption, dataUrl }]);
    const preview =
      document.querySelector<HTMLImageElement>(".screenshot img")!;
    expect(preview.getAttribute("src")).toBe(dataUrl.replace(/\r\n?/g, "\n"));
    expect(preview.alt).toBe(caption);
    expect(document.querySelector(".screenshot-size")!.textContent).toBe(
      expected,
    );
    expect(
      document.querySelector<HTMLButtonElement>(".screenshot-open")!.dataset
        .size,
    ).toBe(expected);
    expect(
      document.querySelector(".screenshot figcaption")!.textContent,
    ).toContain(caption);
    expect(document.querySelector("script")).toBeNull();
    if (expected === "1.25 MB")
      expect((Buffer.byteLength(payload) / 1_000_000).toFixed(2)).toBe("1.67");
  });

  it.each([
    ["<svg>😀</svg>", "<0.01 MB"],
    [`<svg>${"😀".repeat(2500)}</svg>`, "0.01 MB"],
    [`<svg>${"€".repeat(125_000)}</svg>`, "0.38 MB"],
    ["", "0.00 MB"],
  ])("counts percent-encoded SVG UTF-8 bytes (%#)", (svg, expected) => {
    const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    document.body.innerHTML = renderReportScreenshots([
      { caption: "SVG", dataUrl },
    ]);
    expect(document.querySelector(".screenshot-size")!.textContent).toBe(
      expected,
    );
    expect(document.querySelector("img")!.getAttribute("src")).toBe(dataUrl);
  });

  it.each([
    "data:image/png;base64,A",
    "data:image/png;base64,AAAA=",
    "data:image/png;base64,===",
    "data:image/png;base64,invalid!",
    "data:image/png;base64,%ZZ",
    "data:image/png;base64,%FF",
    "data:image/png;base64,AA==\u00a0",
    "data:image/png;base64,AA==\u000b",
    "data:image/svg+xml,%ZZ",
    "https://example.com/image.png",
  ])(
    "shows size unavailable for an invalid or non-data source (%s)",
    (dataUrl) => {
      document.body.innerHTML = renderReportScreenshots([
        { caption: "Unknown", dataUrl },
      ]);
      expect(
        document.querySelector(".screenshot .screenshot-size")!.textContent,
      ).toBe("Size unavailable");
      expect(
        document.querySelector<HTMLButtonElement>(".screenshot-open")!.dataset
          .size,
      ).toBe("Size unavailable");
      expect(
        document.querySelector(".screenshot figcaption")!.textContent,
      ).toContain("Unknown");
      expect(document.querySelector("img")!.getAttribute("src")).toBe(dataUrl);
    },
  );
});

describe("renderReportTimings", () => {
  const at = (offset: number) => startedAt.getTime() + offset;

  it("uses one real-time axis for parallel scrapers, storages, and grouped steps", () => {
    const timings: RunTiming[] = [
      {
        id: "scraper-1",
        kind: "scraper",
        name: "max",
        startedAt: at(0),
        endedAt: at(4000),
      },
      {
        id: "scraper-2",
        kind: "scraper",
        name: "max",
        startedAt: at(1000),
        endedAt: at(3000),
        failed: true,
      },
      {
        id: "storage-1",
        kind: "storage",
        name: 'Sheets <&> "one"',
        startedAt: at(4000),
        endedAt: at(8000),
      },
      {
        id: "storage-2",
        kind: "storage",
        name: "YNAB",
        startedAt: at(4000),
        endedAt: at(6000),
      },
      {
        id: "step-2",
        parentId: "storage-1",
        kind: "step",
        name: "Upload </svg><script>alert(1)</script>",
        startedAt: at(5000),
        endedAt: at(8000),
      },
      {
        id: "step-1",
        parentId: "storage-1",
        kind: "step",
        name: "Connect",
        startedAt: at(4000),
        endedAt: at(5000),
      },
    ];
    expect(
      renderReportTimings(timings, startedAt, new Date(at(10000))),
    ).toMatchSnapshot();
  });

  it("omits a waterfall when no measured timing records exist", () => {
    expect({
      olderReport: renderReportTimings(undefined, startedAt),
      emptyRun: renderReportTimings([], startedAt),
    }).toMatchSnapshot();
  });

  it("shows elapsed running time without inventing a completion timestamp", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(at(1500));
    try {
      expect(
        renderReportTimings(
          [
            {
              id: "running",
              kind: "scraper",
              name: "max",
              startedAt: at(500),
            },
          ],
          startedAt,
        ),
      ).toMatchSnapshot();
    } finally {
      now.mockRestore();
    }
  });

  it("keeps zero-duration activities finite and does not fabricate a duration", () => {
    expect(
      renderReportTimings(
        [
          {
            id: "instant",
            kind: "storage",
            name: "Local JSON",
            startedAt: at(0),
            endedAt: at(0),
          },
        ],
        startedAt,
      ),
    ).toMatchSnapshot();
  });
});

describe("renderHTMLReport", () => {
  it("places timings after storages and before errors and logs", () => {
    const report = baseReport();
    report.storages["Sheets"] = { state: "saving", steps: [] };
    report.errors.push({ caller: "Sheets", message: "Example error" });
    report.timings = [
      {
        id: "sheets",
        kind: "storage",
        name: "Sheets",
        startedAt: startedAt.getTime(),
        endedAt: startedAt.getTime() + 1000,
      },
    ];
    expect(
      [
        ...reportMarkup(renderHTMLReport(report, "Example logs")).matchAll(
          /<h2>([\s\S]*?)<\/h2>/gi,
        ),
      ].map(([, heading]) => heading),
    ).toMatchSnapshot();
  });

  function contentSecurityPolicy(report: string) {
    const meta = report.match(
      /<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/,
    );
    expect(meta).not.toBeNull();
    return new Map(
      meta![1].split("; ").map((directive) => {
        const [name, ...sources] = directive.split(" ");
        return [name, sources];
      }),
    );
  }

  function independentHash(content: string) {
    return `'sha256-${createHash("sha256")
      .update(content.replaceAll("\r\n", "\n").replaceAll("\r", "\n"), "utf8")
      .digest("base64")}'`;
  }

  it.each([
    [false, undefined, false],
    [true, "some logs", true],
  ])(
    "approves exactly the inline scripts and style (transactions=%s, logs=%s, screenshots=%s)",
    (withTransactions, logs, withScreenshots) => {
      const report = baseReport();
      if (withTransactions) report.summary = { results: [successResult()] };
      if (withScreenshots)
        report.screenshots.push({
          caption: "Image",
          dataUrl: "data:image/png;base64,aGVsbG8=",
        });
      const output = renderHTMLReport(report, logs);
      const policy = contentSecurityPolicy(output);
      const scripts = [...output.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
      const styles = [...output.matchAll(/<style>([\s\S]*?)<\/style>/gi)];
      expect(scripts).toHaveLength(2);
      expect(styles).toHaveLength(1);
      expect(policy.get("script-src")).toEqual(
        scripts.length
          ? scripts.map((match) => independentHash(match[1]))
          : ["'none'"],
      );
      expect(policy.get("style-src")).toEqual(
        styles.map((match) => independentHash(match[1])),
      );
      expect(Object.fromEntries(policy)).toMatchObject({
        "default-src": ["'none'"],
        "script-src-attr": ["'none'"],
        "style-src-attr": ["'none'"],
        "img-src": ["data:"],
        "connect-src": ["'none'"],
        "base-uri": ["'none'"],
        "form-action": ["'none'"],
        "object-src": ["'none'"],
      });
    },
  );

  it("hashes HTML-normalized newlines without trimming inline whitespace", () => {
    const content = "\n  const value = 'שלום';\n ";
    const expected = independentHash(content);
    for (const newline of ["\n", "\r\n", "\r"]) {
      expect(hashInlineContent(content.replaceAll("\n", newline))).toBe(
        expected,
      );
    }
    expect(hashInlineContent(content.trim())).not.toBe(expected);
  });

  it("formats the run start with short date and time even without other report data", async () => {
    const output = renderHTMLReport(baseReport());
    const scripts = [...output.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
    expect(scripts).toHaveLength(2);
    const realm = createReportWindow();
    const document = realm.document;
    document.body.innerHTML = output;
    const time = document.querySelector<HTMLTimeElement>("#run-started")!;
    const dateTimeFormat = jest.fn(
      () =>
        new Intl.DateTimeFormat("en-GB", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: "UTC",
        }),
    );
    realm.Intl.DateTimeFormat =
      dateTimeFormat as unknown as typeof Intl.DateTimeFormat;
    await runScripts(realm, output);
    expect(
      document.documentElement.classList.contains("report-interactive"),
    ).toBe(true);
    expect(dateTimeFormat).toHaveBeenCalledWith(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
    expect({
      dateTime: time.dateTime,
      title: time.title,
      textContent: time.textContent,
    }).toMatchSnapshot();
  });

  it("keeps screenshots inside Accounts even when no summary exists", () => {
    const report = baseReport();
    report.screenshots.push({
      caption: "Failure",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    });
    const output = renderHTMLReport(report);
    expect(
      output.match(/<section class="accounts-section">[\s\S]*?<\/section>/)![0],
    ).toMatchSnapshot();
  });

  it("does not approve hostile report data as executable content", () => {
    const hostile =
      '</ScRiPt><ScRiPt>fetch("https://example.invalid")</ScRiPt><StYlE>body{display:none}</StYlE><img src="https://example.invalid" onerror="alert(1)">';
    const report = baseReport();
    report.summary = { results: [successResult()] };
    report.screenshots.push({
      caption: "Safe image",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    });
    const original = renderHTMLReport(report, "safe logs");
    report.scrape.status.push(hostile);
    report.summary.results[0].result.accounts![0].accountNumber = hostile;
    report.summary.results[0].result.accounts![0].txns = [
      transaction({ description: hostile, date: hostile }),
    ];
    report.errors.push({ caller: hostile, message: hostile });
    report.storages[hostile] = { state: "error", message: hostile };
    report.screenshots[0] = {
      caption: hostile,
      dataUrl: "data:image/png;base64,aGVsbG8=",
    };
    const output = renderHTMLReport(report, `${hostile}\r\nraw\rlogs`);
    const policy = contentSecurityPolicy(output);
    expect(policy).toEqual(contentSecurityPolicy(original));
    expect(output.match(/<script>/gi)).toHaveLength(2);
    expect(output.match(/<style>/gi)).toHaveLength(1);
    expect(policy.get("script-src")).not.toContain(independentHash(hostile));
    expect(
      output.match(
        /<template id="transactions-json">([\s\S]*?)<\/template>/,
      )![1],
    ).toMatchSnapshot();
  });

  async function runLogScript(logs: string) {
    const report = renderHTMLReport(baseReport(), logs);
    const realm = createReportWindow();
    const document = realm.document;
    document.body.innerHTML = report;
    const code = document.querySelector<HTMLElement>("#run-logs code")!;
    expect(code.textContent).toBe(logs);
    const serverText = Array.from(code.childNodes).find(
      (node) => node.nodeType === 3,
    );
    let link: HTMLAnchorElement;
    const click = jest
      .spyOn(realm.HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        link = this;
      });
    const remove = jest.spyOn(realm.HTMLAnchorElement.prototype, "remove");
    const highlights = new Map<string, Set<Range>>();
    const createObjectURL = jest.fn((_blob: Blob) => "blob:logs");
    const revokeObjectURL = jest.fn();
    const timers: Array<() => void> = [];

    Object.assign(realm, {
      Highlight: Set,
      CSS: { highlights },
      Blob,
      URL: { createObjectURL, revokeObjectURL },
      setTimeout: (callback: () => void) => timers.push(callback),
    });
    await runScripts(realm, report);
    if (serverText) expect(Array.from(code.childNodes)).toContain(serverText);

    return {
      code,
      get link() {
        return link;
      },
      click,
      remove,
      highlights,
      createObjectURL,
      revokeObjectURL,
      timers,
      async search(term: string) {
        const search =
          document.querySelector<HTMLInputElement>("#search-logs")!;
        search.value = term;
        search.dispatchEvent(new realm.Event("input", { bubbles: true }));
        await document
          .querySelector<ReportLightElement>("report-logs")!
          .ready();
      },
      download() {
        document.querySelector<HTMLButtonElement>("#download-logs")!.click();
      },
    };
  }

  it("filters literal log matches case-insensitively and highlights every occurrence", async () => {
    const logs =
      "\n  Alpha .+ ALPHA .+\r\nunrelated\r<script>.+</script>\n\tend";
    const browser = await runLogScript(logs);
    await browser.search(".+");
    expect(browser.code.textContent).toMatchSnapshot("literal matches");
    expect(browser.highlights.get("log-search")?.size).toBe(3);
    const ranges = [...browser.highlights.get("log-search")!];
    for (const [index, offset] of [8, 17, 29].entries()) {
      expect(ranges[index].startContainer.parentNode).toBe(browser.code);
      expect(ranges[index].startOffset).toBe(offset);
      expect(ranges[index].endOffset).toBe(offset + 2);
      expect(ranges[index].toString()).toBe(".+");
    }

    await browser.search("alpha");
    expect(browser.code.textContent).toMatchSnapshot(
      "case-insensitive matches",
    );
    expect(browser.highlights.get("log-search")?.size).toBe(2);
    await browser.search("[no matches]");
    expect(browser.code.textContent).toMatchSnapshot("no matches");
    expect(browser.highlights.get("log-search")?.size).toBe(0);
    await browser.search("");
    expect(browser.code.textContent).toMatchSnapshot("restored original");
    expect(browser.highlights.get("log-search")?.size).toBe(0);
  });

  it.each([
    ["alpha*beta", 2],
    ["ALPHA?beta", 1],
    ["alpha????beta", 1],
    ["***alpha****beta***", 2],
    ["~*", 2],
    ["~?", 1],
    ["~~", 1],
    ["~* ~? ~~", 1],
    ["~**~?", 1],
    ["[.~*]", 1],
    ['<script>& "', 1],
    ["missing*value", 0],
  ])("matches Excel-style log pattern %s", async (term, count) => {
    const logs =
      'Alpha beta\nALPHA zz BETA\nliteral symbols: * ? ~ [.*]\nspecial <script>& "quotes"\n';
    const browser = await runLogScript(logs);
    await browser.search(term);
    expect(browser.code.textContent).toMatchSnapshot();
    expect(browser.highlights.get("log-search")?.size).toBe(count);
  });

  it("treats question marks as Unicode code points and highlights UTF-16 ranges", async () => {
    const browser = await runLogScript("prefix A😀B suffix\r\nAxxB\r\n");
    await browser.search("a?b");
    expect(browser.code.textContent).toMatchSnapshot();
    expect(browser.highlights.get("log-search")?.size).toBe(1);
    const [range] = browser.highlights.get("log-search")!;
    expect(range.startContainer.parentNode).toBe(browser.code);
    expect(range.startOffset).toBe(7);
    expect(range.endOffset).toBe(11);
    expect(range.toString()).toBe("A😀B");
  });

  it("bounds wildcard work without regex backtracking and handles empty logs", async () => {
    const browser = await runLogScript(`${"a".repeat(2000)}\n`);
    await browser.search(`${"*a".repeat(80)}*z`);
    expect(browser.code.textContent).toMatchSnapshot("no pathological match");
    expect(browser.highlights.get("log-search")?.size).toBe(0);
    await browser.search("*".repeat(1000));
    expect(browser.code.textContent).toHaveLength(2001);
    expect(browser.highlights.get("log-search")?.size).toBe(1);
    const empty = await runLogScript("");
    for (const term of ["", "*", "?"]) {
      await empty.search(term);
      expect(empty.code.textContent).toMatchSnapshot(`empty pattern ${term}`);
      expect(empty.highlights.get("log-search")?.size).toBe(0);
    }
  });

  it("downloads original log whitespace and line endings after filtering", async () => {
    const logs = '\n  <script>" &\r\nfirst\rsecond\r\n\tend  ';
    const browser = await runLogScript(logs);
    await browser.search("f*st");
    browser.download();

    const blob = browser.createObjectURL.mock.calls[0][0];
    expect(await blob.text()).toBe(logs);
    expect(blob.type).toBe("text/plain;charset=utf-8");
    expect(browser.link.download).toBe("logs.txt");
    expect(browser.link.href).toBe("blob:logs");
    expect(browser.click).toHaveBeenCalledTimes(1);
    expect(browser.remove).toHaveBeenCalledTimes(1);
    expect(browser.revokeObjectURL).not.toHaveBeenCalled();
    browser.timers[0]();
    expect(browser.revokeObjectURL).toHaveBeenCalledWith("blob:logs");
  });

  it("downloads full original transactions and account identifiers from inert escaped JSON", async () => {
    const hostile = '</script>& "quotes"\u2028\u2029';
    const original = {
      ...transaction({ description: hostile }),
      identifier: "bank-id",
      memo: hostile,
      extra: { values: ["<&>", 42] },
    };
    const second = transaction({ description: "Second account" });
    const report = baseReport();
    const first = successResult();
    first.result.accounts![0].txns = [original];
    report.summary = {
      results: [
        first,
        {
          companyId: CompanyTypes.visaCal,
          result: {
            success: true,
            accounts: [{ accountNumber: 'other<&"', txns: [second] }],
          },
        },
        {
          companyId: CompanyTypes.leumi,
          result: {
            success: false,
            accounts: [{ accountNumber: "ignored", txns: [transaction({})] }],
          },
        },
      ],
    };
    const output = renderHTMLReport(report);
    const encoded = output.match(
      /<template id="transactions-json">([\s\S]*?)<\/template>/,
    )![1];
    expect(encoded).toMatchSnapshot("inert transaction payload");
    const entities: Record<string, string> = {
      quot: '"',
      amp: "&",
      lt: "<",
      gt: ">",
    };
    const serialized = encoded.replace(
      /&(quot|amp|lt|gt);/g,
      (_, entity) => entities[entity],
    );
    const expected = [
      { ...original, companyId: CompanyTypes.max, accountNumber: "1234" },
      { ...second, companyId: CompanyTypes.visaCal, accountNumber: 'other<&"' },
    ];
    expect(JSON.parse(serialized)).toEqual(expected);
    const realm = createReportWindow();
    const document = realm.document;
    document.body.innerHTML = output;
    let link: HTMLAnchorElement;
    const click = jest
      .spyOn(realm.HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        link = this;
      });
    const remove = jest.spyOn(realm.HTMLAnchorElement.prototype, "remove");
    const createObjectURL = jest.fn((_blob: Blob) => "blob:transactions");
    const revokeObjectURL = jest.fn();
    const timers: Array<() => void> = [];
    Object.assign(realm, {
      Highlight: Set,
      CSS: { highlights: new Map() },
      Blob,
      URL: { createObjectURL, revokeObjectURL },
      setTimeout: (callback: () => void) => timers.push(callback),
    });
    await runScripts(realm, output);
    const search = document.querySelector<HTMLInputElement>(
      "#search-transactions",
    )!;
    search.value = "Second account";
    search.dispatchEvent(new realm.Event("input", { bubbles: true }));
    await document
      .querySelector<ReportLightElement>("report-transactions")!
      .ready();
    document
      .querySelector<HTMLButtonElement>("#download-transactions")!
      .click();
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("application/json;charset=utf-8");
    expect(await blob.text()).toBe(serialized);
    expect(JSON.parse(await blob.text())).toEqual(expected);
    expect(link!.download).toBe("transactions.json");
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    timers[0]();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:transactions");
  });

  it("omits empty transaction downloads and screenshot sections without usable images", () => {
    const emptyResult: AccountScrapeResult = {
      companyId: CompanyTypes.max,
      result: { success: true, accounts: [] },
    };
    const failedResult: AccountScrapeResult = {
      companyId: CompanyTypes.max,
      result: { success: false },
    };
    const screenshots = [
      { caption: "Empty", dataUrl: "" },
      { caption: "Whitespace", dataUrl: " \n " },
    ];
    expect({
      emptyTransactions: renderReportTransactions([emptyResult]),
      failedTransactions: renderReportTransactions([failedResult]),
      noScreenshots: renderReportScreenshots([]),
      emptyScreenshots: renderReportScreenshots(screenshots),
      emptyAccounts: renderReportAccounts([], renderReportScreenshots([])),
    }).toMatchSnapshot();
    expect(
      renderReportScreenshots([
        ...screenshots,
        {
          caption: 'Real <image> "one"',
          dataUrl: "data:image/png;base64,aGVsbG8=",
        },
        {
          caption: "Second",
          dataUrl: "data:image/png;base64,dHdv",
        },
      ]),
    ).toMatchSnapshot("two usable screenshot previews");
  });

  it("keeps all account results and storage states in accessible tables", () => {
    const report = baseReport();
    report.summary = {
      results: [
        successResult(),
        {
          companyId: CompanyTypes.visaCal,
          result: { success: true, accounts: [] },
        },
        {
          companyId: CompanyTypes.leumi,
          result: {
            success: false,
            errorType: ScraperErrorTypes.InvalidPassword,
            errorMessage: "<full failure>",
          },
        },
        {
          companyId: CompanyTypes.max,
          result: { success: false },
        },
      ],
    };
    report.storages["Saving <storage>"] = {
      state: "saving",
      steps: [{ name: "Loading <data>" }, step("Loaded", 100)],
    };
    report.storages["Failed"] = { state: "error", message: "<full error>" };
    report.storages["Saved"] = {
      state: "done",
      stats: createSaveStats("Saved", "Budget <table>", [], {
        added: 2,
        existing: 3,
        pending: 4,
        otherSkipped: 5,
        total: 14,
      }),
      durationMs: 1250,
      steps: [],
    };
    report.storages["Waiting"] = { state: "saving", steps: [] };
    expect({
      accounts: renderReportAccounts(report.summary.results),
      storages: renderReportStorages(report.storages),
    }).toMatchSnapshot();
  });

  it("renders logs with whitespace and escaped markup", () => {
    const logs =
      '\n  unique-log <&> "</pre><script>alert(1)</script>"\r\nfirst\rsecond\r\n\tend';
    expect(renderReportLogs(logs)).toMatchSnapshot();
  });

  it("embeds screenshots and errors in an offline report without a final-status block", () => {
    const report = baseReport();
    report.failed = true;
    report.scrape.totalTimeSec = 12.34;
    report.summary = {
      results: [
        successResult(),
        {
          companyId: CompanyTypes.max,
          result: {
            success: false,
            errorType: ScraperErrorTypes.Generic,
            errorMessage: "Scraping failed\n    at scraper (bank.js:1:1)",
          },
        },
      ],
    };
    const tx = {
      ...transaction({ description: "Shop" }),
      hash: "h",
      uniqueId: "u",
      account: "1234",
      companyId: CompanyTypes.max,
    };
    report.storages["Sheets"] = {
      state: "done",
      stats: createSaveStats("Sheets", "TheTable", [tx], {
        added: 1,
        existing: 0,
      }),
      durationMs: 1200,
      steps: [step("Upload transactions", 800)],
    };
    report.storages["Web"] = {
      state: "error",
      message: "Storage failed\n    at save (storage.js:1:1)",
    };
    report.errors.push({ caller: "scraper", message: "<failed>" });
    report.screenshots.push({
      caption: "Failure <image>",
      dataUrl: "data:image/png;base64,aGVsbG8=",
    });

    const html = renderHTMLReport(report);

    expect(reportMarkup(html)).toMatchSnapshot();
  });
});
