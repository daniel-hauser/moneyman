import { CompanyTypes } from "israeli-bank-scrapers";
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
