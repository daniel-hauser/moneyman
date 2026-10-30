import { CompanyTypes } from "israeli-bank-scrapers";
import { runInNewContext } from "node:vm";
import { mock } from "jest-mock-extended";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";
import { AccountScrapeResult } from "../types.js";
import { transaction } from "../utils/tests.js";
import { createSaveStats } from "./saveStats.js";
import {
  createRunReport,
  renderFullReport,
  renderHTMLReport,
  renderRunReport,
  TELEGRAM_MESSAGE_LIMIT,
  type RunReport,
} from "./runReport.js";

const startedAt = new Date("2024-01-01T10:00:00Z");

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
    // Telegram has no nested blockquotes
    expect(text).not.toMatch(
      /<blockquote[^>]*>(?:(?!<\/blockquote>).)*<blockquote/s,
    );
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
    expect(text).not.toContain("at JSON.parse");
    expect(text).not.toContain("at foo");
    expect(text).not.toMatch(/&(?![a-z]+;)/);
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
    expect(text.match(/❌ \[max\]/g)).toHaveLength(8);
    expect(text).not.toContain("+3 more");
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
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("renderFullReport", () => {
  it("equals the sent message when nothing is shortened", () => {
    const report = baseReport();
    report.summary = { results: [successResult()] };
    report.storages["Sheets"] = { state: "error", message: "boom" };
    expect(renderFullReport(report)).toBe(renderRunReport(report));
  });

  it("differs when errors are shortened or the limit is hit", () => {
    const report = baseReport();
    report.storages["Sheets"] = { state: "error", message: "x".repeat(1000) };
    expect(renderFullReport(report)).toContain("x".repeat(1000));
    expect(renderFullReport(report)).not.toBe(renderRunReport(report));

    const big = baseReport();
    for (let i = 0; i < 400; i++) {
      big.storages[`Storage ${i}`] = { state: "saving", steps: [] };
    }
    expect(renderFullReport(big)).not.toBe(renderRunReport(big));
  });
});

describe("renderHTMLReport", () => {
  it("omits the log viewer and download script when logs are unavailable", () => {
    const html = renderHTMLReport(baseReport());

    expect(html).not.toContain("<h2>Logs</h2>");
    expect(html).not.toContain('id="run-logs"');
    expect(html).not.toContain("<script>");
  });

  it("inlines the complete escaped log exactly once in a fixed-height viewer", () => {
    const logs = '\n  unique-log <&> "</pre><script>alert(1)</script>"\n\tend';
    const escaped =
      '\n  unique-log &lt;&amp;&gt; "&lt;/pre&gt;&lt;script&gt;alert(1)&lt;/script&gt;"\n\tend';
    const html = renderHTMLReport(baseReport(), logs);

    expect(html).toContain(
      `<pre id="run-logs" class="run-logs"><code>${escaped}</code></pre>`,
    );
    expect(html.split("unique-log")).toHaveLength(2);
    expect(html).not.toContain(logs);
    expect(html).toMatch(
      /\.run-logs \{\s*height: 24rem;\s*overflow: auto;\s*white-space: pre;\s*content-visibility: auto;/,
    );
  });

  it("preserves CR and CRLF in the DOM log source using character references", () => {
    const html = renderHTMLReport(baseReport(), "\r\nfirst\rsecond\r\nlast");

    expect(html).toContain(
      '<pre id="run-logs" class="run-logs"><code>&#13;\nfirst&#13;second&#13;\nlast</code></pre>',
    );
  });

  it("downloads JSON from the viewer text, with a temporary object URL", async () => {
    const html = renderHTMLReport(baseReport(), "original log");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    const logs = '\n  DOM log <&> "</script>"\n\tend';
    const button = { addEventListener: jest.fn() };
    const link = mock<HTMLAnchorElement>();
    const document = {
      getElementById: jest.fn((id: string) =>
        id === "download-logs" ? button : { textContent: logs },
      ),
      createElement: jest.fn(() => link),
      body: { appendChild: jest.fn() },
    };
    const URL = {
      createObjectURL: jest.fn((blob: Blob) => "blob:logs"),
      revokeObjectURL: jest.fn(),
    };
    const setTimeout = jest.fn();
    runInNewContext(script, { document, URL, Blob, setTimeout });
    expect(button.addEventListener).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
    );

    button.addEventListener.mock.calls[0][1]();

    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual({ logs });
    expect(document.createElement).toHaveBeenCalledWith("a");
    expect(link.download).toBe("logs.json");
    expect(link.href).toBe("blob:logs");
    expect(document.body.appendChild).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 0);
    setTimeout.mock.calls[0][0]();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:logs");
  });

  it("embeds screenshots and errors in an offline report with final status", () => {
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

    expect(html).toMatchSnapshot();
  });
});
