import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { mock } from "jest-mock-extended";
import { CompanyTypes } from "israeli-bank-scrapers";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";
import { AccountScrapeResult } from "../types.js";
import { transaction } from "../utils/tests.js";
import { createSaveStats } from "./saveStats.js";
import { hashInlineContent } from "./report/html.js";
import { reportStyles } from "./report/assets.generated.js";
import {
  renderReportAccounts,
  renderReportStorages,
  renderReportScreenshots,
  renderReportTransactions,
  renderReportLogs,
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
      /<script>[\s\S]*?<\/script>/g,
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
    expect({
      full: renderFullReport(report),
      sent: renderRunReport(report),
    }).toMatchSnapshot();
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

describe("renderHTMLReport", () => {
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
    [false, "", false],
    [true, undefined, false],
    [true, "some logs\r\nnext line", false],
    [false, undefined, true],
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
      const scripts = [...output.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      const styles = [...output.matchAll(/<style>([\s\S]*?)<\/style>/g)];
      expect(scripts).toHaveLength(1);
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

  it("formats the run start with short date and time even without other report data", () => {
    const output = renderHTMLReport(baseReport());
    const scripts = [...output.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    const time = mock<HTMLTimeElement>({
      dateTime: startedAt.toISOString(),
      title: startedAt.toISOString(),
      textContent: startedAt.toISOString(),
    });
    const document = mock<Document>();
    document.querySelector.mockImplementation((selector) =>
      selector === "#run-started" ? time : null,
    );
    document.querySelectorAll.mockReturnValue(mock<NodeListOf<Element>>());
    const dateTimeFormat = jest.fn(
      () =>
        new Intl.DateTimeFormat("en-GB", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: "UTC",
        }),
    );
    runInNewContext(scripts[0][1], {
      document,
      Intl: { DateTimeFormat: dateTimeFormat },
      Date,
    });
    expect(document.querySelector).toHaveBeenCalledWith("#run-started");
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

  it("keeps account and storage column sizing independent of expanded error content", () => {
    expect(
      reportStyles
        .split("}")
        .filter((rule) =>
          /results-table|accounts-table|storages-table|td \.error-message/.test(
            rule,
          ),
        )
        .map((rule) => `${rule.trim()}}`),
    ).toMatchSnapshot();
  });

  it("shares search and download control sizing and interaction styles", () => {
    expect(
      reportStyles
        .split("}")
        .filter((rule) => /report-search|download-button/.test(rule))
        .map((rule) => `${rule.trim()}}`),
    ).toMatchSnapshot();
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

  it("shares one inline SVG symbol across both download icons", () => {
    const report = baseReport();
    report.summary = { results: [successResult()] };
    const output = renderHTMLReport(report, "logs");
    expect({
      symbols: output.match(/<symbol\b[\s\S]*?<\/symbol>/g),
      uses: output.match(/<use\b[^>]*\/>/g),
    }).toMatchSnapshot();
  });

  it("does not approve hostile report data as executable content", () => {
    const hostile =
      '</script><script>fetch("https://example.invalid")</script><style>body{display:none}</style><img src="https://example.invalid" onerror="alert(1)">';
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
    expect(output.match(/<script>/g)).toHaveLength(1);
    expect(output.match(/<style>/g)).toHaveLength(1);
    expect(policy.get("script-src")).not.toContain(independentHash(hostile));
    expect(
      output.match(
        /<template id="transactions-json">([\s\S]*?)<\/template>/,
      )![1],
    ).toMatchSnapshot();
  });

  function runLogScript(logs: string) {
    const report = renderHTMLReport(baseReport(), logs);
    const code = mock<HTMLElement>({ localName: "pre", textContent: logs });
    const started = mock<HTMLTimeElement>({
      dateTime: startedAt.toISOString(),
    });
    const search = mock<HTMLInputElement>();
    const download = mock<HTMLButtonElement>({
      dataset: {
        download: "run-logs",
        filename: "logs.txt",
        type: "text/plain;charset=utf-8",
      },
    });
    const link = mock<HTMLAnchorElement>();
    const document = mock<Document>();
    document.body = mock<HTMLElement>();
    document.querySelector.mockImplementation((selector) =>
      selector === "#run-started"
        ? started
        : selector === "#search-logs"
          ? search
          : selector === "#run-logs code"
            ? code
            : null,
    );
    document.getElementById.mockImplementation((id) =>
      id === "run-started"
        ? started
        : id === "search-logs"
          ? search
          : id === "run-logs"
            ? code
            : download,
    );
    const buttons = mock<NodeListOf<HTMLButtonElement>>();
    buttons.forEach.mockImplementation((callback) =>
      callback(download, 0, buttons),
    );
    document.querySelectorAll.mockImplementation((selector) =>
      selector === "[data-download]" ? buttons : mock<NodeListOf<Element>>(),
    );
    document.createTextNode.mockImplementation((text) =>
      mock<Text>({ textContent: text }),
    );
    document.createElement.mockReturnValue(link);
    code.replaceChildren.mockImplementation((node) => {
      code.textContent =
        (typeof node === "string" ? node : node.textContent) ?? "";
    });
    const highlights = new Map<string, Set<Range>>();
    const ranges: Range[] = [];
    const createObjectURL = jest.fn((_blob: Blob) => "blob:logs");
    const revokeObjectURL = jest.fn();
    const timers: Array<() => void> = [];
    document.createRange.mockImplementation(() => {
      const range = mock<Range>();
      ranges.push(range);
      return range;
    });

    const context = {
      document,
      Highlight: Set,
      CSS: { highlights },
      Blob,
      URL: { createObjectURL, revokeObjectURL },
      setTimeout: (callback: () => void) => timers.push(callback),
    };
    for (const script of report.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      runInNewContext(script[1], context);
    }

    function fire(element: typeof search | typeof download) {
      const listener = element.addEventListener.mock.calls[0][1];
      if (typeof listener !== "function") throw new Error("Missing listener");
      listener.call(element, mock<Event>({ target: element }));
    }

    return {
      code,
      link,
      ranges,
      highlights,
      createObjectURL,
      revokeObjectURL,
      timers,
      search(term: string) {
        search.value = term;
        fire(search);
      },
      download() {
        fire(download);
      },
    };
  }

  it("filters literal log matches case-insensitively and highlights every occurrence", () => {
    const logs =
      "\n  Alpha .+ ALPHA .+\r\nunrelated\r<script>.+</script>\n\tend";
    const browser = runLogScript(logs);
    browser.search(".+");
    expect(browser.code.textContent).toMatchSnapshot("literal matches");
    expect(browser.highlights.get("log-search")?.size).toBe(3);
    const node = browser.code.replaceChildren.mock.calls[0][0];
    for (const [index, offset] of [8, 17, 29].entries()) {
      expect(browser.ranges[index].setStart).toHaveBeenCalledWith(node, offset);
      expect(browser.ranges[index].setEnd).toHaveBeenCalledWith(
        node,
        offset + 2,
      );
    }

    browser.search("alpha");
    expect(browser.code.textContent).toMatchSnapshot(
      "case-insensitive matches",
    );
    expect(browser.highlights.get("log-search")?.size).toBe(2);
    browser.search("[no matches]");
    expect(browser.code.textContent).toMatchSnapshot("no matches");
    expect(browser.highlights.get("log-search")?.size).toBe(0);
    browser.search("");
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
  ])("matches Excel-style log pattern %s", (term, count) => {
    const logs =
      'Alpha beta\nALPHA zz BETA\nliteral symbols: * ? ~ [.*]\nspecial <script>& "quotes"\n';
    const browser = runLogScript(logs);
    browser.search(term);
    expect(browser.code.textContent).toMatchSnapshot();
    expect(browser.highlights.get("log-search")?.size).toBe(count);
  });

  it("treats question marks as Unicode code points and highlights UTF-16 ranges", () => {
    const browser = runLogScript("prefix A😀B suffix\r\nAxxB\r\n");
    browser.search("a?b");
    expect(browser.code.textContent).toMatchSnapshot();
    expect(browser.highlights.get("log-search")?.size).toBe(1);
    const node = browser.code.replaceChildren.mock.calls[0][0];
    expect(browser.ranges[0].setStart).toHaveBeenCalledWith(node, 7);
    expect(browser.ranges[0].setEnd).toHaveBeenCalledWith(node, 11);
  });

  it("bounds wildcard work without regex backtracking and handles empty logs", () => {
    const browser = runLogScript(`${"a".repeat(2000)}\n`);
    browser.search(`${"*a".repeat(80)}*z`);
    expect(browser.code.textContent).toMatchSnapshot("no pathological match");
    expect(browser.highlights.get("log-search")?.size).toBe(0);
    browser.search("*".repeat(1000));
    expect(browser.code.textContent).toHaveLength(2001);
    expect(browser.highlights.get("log-search")?.size).toBe(1);
    const empty = runLogScript("");
    for (const term of ["", "*", "?"]) {
      empty.search(term);
      expect(empty.code.textContent).toMatchSnapshot(`empty pattern ${term}`);
      expect(empty.highlights.get("log-search")?.size).toBe(0);
    }
  });

  it("downloads original log whitespace and line endings after filtering", async () => {
    const logs = '\n  <script>" &\r\nfirst\rsecond\r\n\tend  ';
    const browser = runLogScript(logs);
    browser.search("f*st");
    browser.download();

    const blob = browser.createObjectURL.mock.calls[0][0];
    expect(await blob.text()).toBe(logs);
    expect(blob.type).toBe("text/plain;charset=utf-8");
    expect(browser.link.download).toBe("logs.txt");
    expect(browser.link.href).toBe("blob:logs");
    expect(browser.link.click).toHaveBeenCalledTimes(1);
    expect(browser.link.remove).toHaveBeenCalledTimes(1);
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
    const button = mock<HTMLButtonElement>({
      dataset: {
        download: "transactions-json",
        filename: "transactions.json",
        type: "application/json;charset=utf-8",
      },
    });
    const document = mock<Document>();
    document.body = mock<HTMLElement>();
    const buttons = mock<NodeListOf<HTMLButtonElement>>();
    buttons.forEach.mockImplementation((callback) =>
      callback(button, 0, buttons),
    );
    document.querySelectorAll.mockReturnValue(buttons);
    document.getElementById.mockReturnValue(
      mock<HTMLTemplateElement>({
        localName: "template",
        textContent: "",
        content: { textContent: serialized },
      }),
    );
    const link = mock<HTMLAnchorElement>();
    document.createElement.mockReturnValue(link);
    const createObjectURL = jest.fn((_blob: Blob) => "blob:transactions");
    const revokeObjectURL = jest.fn();
    const timers: Array<() => void> = [];
    const scripts = [...output.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    runInNewContext(scripts.at(-1)![1], {
      document,
      Blob,
      URL: { createObjectURL, revokeObjectURL },
      setTimeout: (callback: () => void) => timers.push(callback),
    });
    const listener = button.addEventListener.mock.calls[0][1];
    if (typeof listener !== "function")
      throw new Error("Missing download listener");
    listener.call(button, mock<Event>({ target: button }));
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("application/json;charset=utf-8");
    expect(JSON.parse(await blob.text())).toEqual(expected);
    expect(link.download).toBe("transactions.json");
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.remove).toHaveBeenCalledTimes(1);
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

    expect(reportMarkup(html)).toMatchSnapshot();
  });
});
