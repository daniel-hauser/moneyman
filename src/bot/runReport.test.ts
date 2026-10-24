import { CompanyTypes } from "israeli-bank-scrapers";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";
import { AccountScrapeResult } from "../types.js";
import { Timer } from "../utils/Timer.js";
import { transaction } from "../utils/tests.js";
import { createSaveStats } from "./saveStats.js";
import {
  createRunReport,
  htmlToText,
  isReportTruncated,
  renderFullReportText,
  renderRunReport,
  TELEGRAM_MESSAGE_LIMIT,
  type RunReport,
} from "./runReport.js";

const startedAt = new Date("2024-01-01T10:00:00Z");

function step(name: string, duration: number) {
  return Object.assign(new Timer(name), { duration });
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
    report.storages.set("Sheets", {
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
    });
    report.storages.set("YNAB", {
      state: "saving",
      steps: [step("Loading", 5)],
    });
    report.storages.set("Web", {
      state: "error",
      message: "boom",
    });
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
    report.storages.set("Sheets", {
      state: "error",
      message: `${"<&>".repeat(300)}\n    at foo (bar.js:1:1)`,
    });
    const text = renderRunReport(report);
    expect(text).not.toContain("at JSON.parse");
    expect(text).not.toContain("at foo");
    expect(text).not.toMatch(/&(?![a-z]+;)/);
    expect(text).toMatchSnapshot();
  });

  it("caps the number of failed accounts", () => {
    const report = baseReport();
    report.summary = {
      results: Array.from({ length: 8 }, () => ({
        companyId: CompanyTypes.max,
        result: { success: false, errorType: ScraperErrorTypes.Generic },
      })),
    };
    expect(renderRunReport(report)).toContain("+3 more");
  });

  it("never exceeds the Telegram limit", () => {
    const report = baseReport();
    report.summary = { results: [successResult()] };
    for (let i = 0; i < 400; i++) {
      report.storages.set(`Storage ${i}`, {
        state: "saving",
        steps: [step("A step with a long name that takes space", 1)],
      });
    }
    const text = renderRunReport(report);
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(text.split("<blockquote").length).toBe(
      text.split("</blockquote>").length,
    );
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("truncation detection", () => {
  const failedAccounts = (n: number): AccountScrapeResult[] =>
    Array.from({ length: n }, () => ({
      companyId: CompanyTypes.max,
      result: {
        success: false,
        errorType: ScraperErrorTypes.Generic,
        errorMessage: "failed",
      },
    }));

  it("is false for a short report", () => {
    const report = baseReport();
    report.summary = { results: [successResult(), ...failedAccounts(2)] };
    report.storages.set("Sheets", { state: "error", message: "boom" });
    expect(isReportTruncated(report)).toBe(false);
  });

  it("is true for a long account error", () => {
    const report = baseReport();
    report.summary = {
      results: [
        {
          companyId: CompanyTypes.max,
          result: {
            success: false,
            errorType: ScraperErrorTypes.Generic,
            errorMessage: "first\n    at JSON.parse (<anonymous>)",
          },
        },
      ],
    };
    expect(isReportTruncated(report)).toBe(true);
  });

  it("is true for a long storage error", () => {
    const report = baseReport();
    report.storages.set("Sheets", {
      state: "error",
      message: "x".repeat(1000),
    });
    expect(isReportTruncated(report)).toBe(true);
  });

  it("is true when failed accounts are capped", () => {
    const report = baseReport();
    report.summary = { results: failedAccounts(8) };
    expect(isReportTruncated(report)).toBe(true);
  });

  it("is true when storage details are dropped", () => {
    const report = baseReport();
    report.summary = { results: [successResult()] };
    for (let i = 0; i < 100; i++) {
      report.storages.set(`Storage ${i}`, {
        state: "saving",
        steps: [step("A step with a long name that takes space", 1)],
      });
    }
    expect(renderRunReport(report)).not.toContain("A step with");
    expect(isReportTruncated(report)).toBe(true);
  });

  it("is true when the message is cut to the limit", () => {
    const report = baseReport();
    for (let i = 0; i < 400; i++) {
      report.storages.set(`Storage ${i}`, { state: "saving", steps: [] });
    }
    expect(isReportTruncated(report)).toBe(true);
  });

  it("renders the full report as plain text without caps", () => {
    const report = baseReport();
    report.summary = { results: failedAccounts(8) };
    report.storages.set("Sheets", {
      state: "error",
      message: `<${"x".repeat(1000)}>\n    at foo (bar.js:1:1)`,
    });
    const text = renderFullReportText(report);
    expect(text).not.toContain("blockquote");
    expect(text).not.toContain("more");
    expect(text).toContain(`<${"x".repeat(1000)}>`);
    expect(text).toContain("at foo (bar.js:1:1)");
    expect(text.match(/❌ \[max\]/g)).toHaveLength(8);
  });

  it("htmlToText strips tags and unescapes entities", () => {
    expect(
      htmlToText("<blockquote expandable>a &lt;b&gt; &amp;&quot;</blockquote>"),
    ).toBe('a <b> &"');
  });
});
