/** @jest-environment ./report/test-environment.cjs */
import { mock } from "jest-mock-extended";
import { Blob, Buffer } from "node:buffer";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { transaction } from "../src/utils/tests.js";
import {
  initializeTransactions,
  initializeLogs,
  initializeDownloads,
  initializeScreenshots,
} from "./client.js";
import {
  ReportTransactions,
  ReportLogs,
} from "../src/bot/report/interactive.js";
import { reportClientScript } from "../src/bot/report/assets.generated.js";
import type { ReportTransaction, SortKey } from "./transactions.js";
import {
  renderReportTransactions,
  renderReportLogs,
} from "../src/bot/report/components.js";
import type { AccountScrapeResult } from "../src/types.js";

declare function createReportWindow(): Window & typeof globalThis;

async function browser(bundled = false, locale = "en-GB", restored = "") {
  const originals: ReportTransaction[] = [
    {
      ...transaction({
        date: "2024-01-03T12:00:00Z",
        chargedAmount: 100,
        chargedCurrency: "€",
        description: "Alpha first",
      }),
      companyId: "max",
      accountNumber: "acct10",
    },
    {
      ...transaction({
        date: "2024-01-01T12:00:00Z",
        status: TransactionStatuses.Pending,
        originalAmount: -5,
        originalCurrency: "$",
        chargedAmount: 999,
        description: "Beta 😀 <script> &",
      }),
      companyId: "max",
      accountNumber: "acct2",
    },
    {
      ...transaction({
        date: "2024-01-02T12:00:00Z",
        chargedAmount: 20,
        description: "Alpha second",
      }),
      companyId: "max",
      accountNumber: "acct2",
    },
    {
      ...transaction({
        date: "2024-01-02T12:00:00Z",
        chargedAmount: 20,
        description: "Alpha tie",
      }),
      companyId: "visaCal",
      accountNumber: "acct02",
    },
    {
      ...transaction({
        date: "invalid date",
        chargedAmount: 0,
        description: "Invalid",
      }),
      companyId: "max",
      accountNumber: "acct1",
    },
  ];
  const realm = bundled ? createReportWindow() : window;
  const document = realm.document;
  document.body.innerHTML = renderReportTransactions(
    originals.map((row) => ({
      companyId: row.companyId,
      result: {
        success: true,
        accounts: [
          {
            accountNumber: row.accountNumber,
            txns: [{ ...row, memo: "SECRET_HIDDEN" }],
          },
        ],
      },
    })) as AccountScrapeResult[],
  );
  const payload =
    document.querySelector<HTMLTemplateElement>("#transactions-json")!;
  const body =
    document.querySelector<HTMLTableSectionElement>("#transaction-rows")!;
  const count = document.querySelector<HTMLElement>("#transaction-count")!;
  const keys: SortKey[] = ["date", "amount", "account"];
  const headers = Array.from(document.querySelectorAll("th[aria-sort]"));
  headers.forEach((header, index) => {
    const label = Array.from(header.childNodes).find(
      (node) =>
        node.nodeType === 3 &&
        node.textContent?.includes(["Date", "Amount", "Account"][index]),
    );
    expect(label?.textContent).toMatch(
      new RegExp(`${["Date", "Amount", "Account"][index]} $`),
    );
  });
  const serverRows = Array.from(body.rows);
  const serverTimes = Array.from(body.querySelectorAll("time"));
  const serverSearch = document.querySelector("#search-transactions");
  (serverSearch as HTMLInputElement).value = restored;
  const serverButtons = Array.from(document.querySelectorAll("[data-sort]"));
  expect(body.rows).toHaveLength(originals.length);
  expect(body.rows[0].cells[2].textContent).toBe("Alpha first");
  expect(serverTimes[0].textContent).toBe("03/01/2024");
  const highlights = new Map<string, Range[]>([
    ["log-search", [mock<Range>()]],
  ]);
  const highlight = jest.fn((name: string, ranges: Range[]) =>
    highlights.set(name, ranges),
  );
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeZone: "UTC",
  });
  const DateTimeFormat = Intl.DateTimeFormat;
  jest
    .spyOn(Intl, "DateTimeFormat")
    .mockImplementation((language, options) =>
      language === undefined
        ? formatter
        : new DateTimeFormat(language, options),
    );
  const fetch = jest.fn();
  const XMLHttpRequest = jest.fn();
  if (bundled) {
    Object.assign(realm, {
      Intl,
      fetch,
      XMLHttpRequest,
      Highlight: Set,
      CSS: {
        highlights: {
          set(name: string, ranges: Set<Range>) {
            highlights.set(name, [...ranges]);
          },
        },
      },
    });
    realm.eval(reportClientScript);
    await document
      .querySelector<ReportTransactions>("report-transactions")!
      .ready();
    await Promise.resolve();
  } else {
    await initializeTransactions(document, highlight);
  }

  const search = document.querySelector<HTMLInputElement>(
    "#search-transactions",
  )!;
  const element = document.querySelector<ReportTransactions>(
    "report-transactions",
  )!;
  expect(element.constructor).toBe(
    realm.customElements.get("report-transactions"),
  );
  expect(element.shadowRoot).toBeNull();
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-sort]"),
  );
  Array.from(body.rows).forEach((row) => expect(serverRows).toContain(row));
  Array.from(body.querySelectorAll("time")).forEach((time) =>
    expect(serverTimes).toContain(time),
  );
  expect(search).toBe(serverSearch);
  buttons.forEach((button, index) => expect(button).toBe(serverButtons[index]));
  const times = Array.from(body.querySelectorAll("time")).map(
    (time) => time.cloneNode(true) as HTMLTimeElement,
  );
  return {
    document,
    element,
    fetch,
    XMLHttpRequest,
    originals,
    payload,
    count,
    highlights,
    headers,
    buttons,
    body,
    times,
    rows: () =>
      Array.from(body.rows, (row) =>
        Array.from(row.cells, (cell) => cell.textContent),
      ),
    matchedText: () =>
      (highlights.get("transactions-search") ?? []).map((range) =>
        range.toString(),
      ),
    async search(term: string) {
      search.value = term;
      search.dispatchEvent(new realm.Event("input", { bubbles: true }));
      await document
        .querySelector<ReportTransactions>("report-transactions")!
        .ready();
    },
    async sort(key: SortKey) {
      buttons[keys.indexOf(key)].click();
      await document
        .querySelector<ReportTransactions>("report-transactions")!
        .ready();
    },
  };
}

afterEach(() => jest.restoreAllMocks());

it.each(
  [false, true].flatMap((bundled) =>
    [
      ["empty child part", "", ""],
      ["NUL only", "\0", "\uFFFD"],
      ["lone high surrogate", "\uD800", "\uFFFD"],
      ["lone low surrogate", "\uDC00", "\uFFFD"],
      ["paired emoji", "😀", "😀"],
      [
        "invalid date controls",
        "invalid:\0\uD800|\uDC00",
        "invalid:\uFFFD\uFFFD|\uFFFD",
      ],
    ].map(([name, value, parsed]) => [bundled, name, value, parsed] as const),
  ),
)(
  "preserves exact bare %s/%s display text immediately after readiness without filtering",
  async (bundled, _name, value, parsed) => {
    const output =
      renderReportTransactions([
        {
          companyId: "max",
          result: {
            success: true,
            accounts: [
              {
                accountNumber: "123",
                txns: [transaction({ date: value, description: value })],
              },
            ],
          },
        },
      ] as AccountScrapeResult[]) + renderReportLogs(value);
    const realm = bundled ? createReportWindow() : window;
    const document = realm.document;
    document.body.innerHTML = Buffer.from(output).toString("utf8");
    const cell = document
      .querySelector("#transaction-rows tr")!
      .querySelectorAll("td")[2];
    const time = document.querySelector<HTMLTimeElement>(".transaction-date")!;
    const code = document.querySelector("#run-logs code")!;
    const elements = [cell, time, code];
    const textNodes = elements.map((element) =>
      Array.from(element.childNodes).find((node) => node.nodeType === 3),
    );
    elements.forEach((element) => expect(element.textContent).toBe(parsed));
    if (!value) expect(textNodes).toEqual([undefined, undefined, undefined]);
    const payload =
      document.querySelector<HTMLTemplateElement>("#transactions-json")!;
    const json = payload.content.textContent;
    Object.assign(realm, { Highlight: Set, CSS: { highlights: new Map() } });
    if (bundled) realm.eval(reportClientScript);
    else
      await Promise.all([
        initializeTransactions(document, jest.fn()),
        initializeLogs(document, jest.fn()),
      ]);
    const transactions = document.querySelector<ReportTransactions>(
      "report-transactions",
    )!;
    const logs = document.querySelector<ReportLogs>("report-logs")!;
    await Promise.all([transactions.ready(), logs.ready()]);
    // Check before any filter or sort can change the committed string.
    expect(document.querySelector("#run-logs code")).toBe(code);
    expect(document.querySelector(".transaction-date")).toBe(time);
    expect(
      document.querySelector("#transaction-rows tr")!.querySelectorAll("td")[2],
    ).toBe(cell);
    elements.forEach((element, index) => {
      expect(element.textContent).toBe(value);
      expect(
        Array.from(element.childNodes).find((node) => node.nodeType === 3),
      ).toBe(textNodes[index]);
    });
    expect(time.dateTime).toBe(value);
    expect(time.title).toBe(value);
    expect(transactions.transactions[0].date).toBe(value);
    expect(transactions.transactions[0].description).toBe(value);
    expect(logs.logs).toBe(value);
    expect(payload.content.textContent).toBe(json);
    transactions.requestUpdate();
    logs.requestUpdate();
    await Promise.all([transactions.ready(), logs.ready()]);
    elements.forEach((element) => expect(element.textContent).toBe(value));
    expect(payload.content.textContent).toBe(json);
  },
);

it.each([false, true])(
  "restores NUL and lone surrogates after parsed-SSR hydration while retaining nodes and original downloads (bundled=%s)",
  async (bundled) => {
    const original = "sentinel:\0\uD800|low:\uDC00|valid:😀";
    const parsed = "sentinel:\uFFFD\uFFFD|low:\uFFFD|valid:😀";
    const logs = `first\r\n${original}\r\nlast\r`;
    const output =
      renderReportTransactions([
        {
          companyId: "max",
          result: {
            success: true,
            accounts: [
              {
                accountNumber: original,
                txns: [transaction({ date: original, description: original })],
              },
            ],
          },
        },
      ] as AccountScrapeResult[]) + renderReportLogs(logs);
    const realm = bundled ? createReportWindow() : window;
    const document = realm.document;
    // Include the same UTF-8 boundary as a report written to disk.
    document.body.innerHTML = Buffer.from(output).toString("utf8");
    const row = document.querySelector<HTMLTableRowElement>(
      "#transaction-rows tr",
    )!;
    const time = row.querySelector("time")!;
    const code = document.querySelector("#run-logs code")!;
    const text = (element: Element) =>
      Array.from(element.childNodes).find((node) => node.nodeType === 3)!;
    const cellText = text(row.cells[2]);
    const timeText = text(time);
    const logText = text(code);
    const nodes = Array.from(
      document.querySelectorAll("tr, td, time, input, button, code"),
    );
    expect(row.cells[2].textContent).toBe(parsed);
    expect(time.textContent).toBe(parsed);
    expect(code.textContent).toBe(`first\r\n${parsed}\r\nlast\r`);
    const payload =
      document.querySelector<HTMLTemplateElement>("#transactions-json")!;
    const json = payload.content.textContent!;
    expect(JSON.parse(json)[0].description).toBe(original);
    const createObjectURL = jest.fn((_blob: Blob) => "blob:original");
    const blob = jest.fn(
      (parts: string[], options: BlobPropertyBag) => new Blob(parts, options),
    );
    Object.assign(realm, {
      Highlight: Set,
      CSS: { highlights: new Map() },
      Blob: blob,
    });
    Object.assign(realm.URL, { createObjectURL, revokeObjectURL: jest.fn() });
    jest
      .spyOn(realm.HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    if (bundled) realm.eval(reportClientScript);
    else {
      await Promise.all([
        initializeTransactions(document, jest.fn()),
        initializeLogs(document, jest.fn()),
      ]);
      initializeDownloads(document);
    }
    const transactions = document.querySelector<ReportTransactions>(
      "report-transactions",
    )!;
    const logElement = document.querySelector<ReportLogs>("report-logs")!;
    await Promise.all([transactions.ready(), logElement.ready()]);
    await Promise.resolve();
    Array.from(
      document.querySelectorAll("tr, td, time, input, button, code"),
    ).forEach((node, index) => expect(node).toBe(nodes[index]));
    expect(text(row.cells[2])).toBe(cellText);
    expect(text(time)).toBe(timeText);
    expect(text(code)).toBe(logText);
    expect(row.cells[2].textContent).toBe(original);
    expect(row.cells[3].textContent).toBe(original);
    expect(time.textContent).toBe(original);
    expect(time.dateTime).toBe(original);
    expect(time.title).toBe(original);
    expect(code.textContent).toBe(logs);
    for (const [selector, element] of [
      ["#search-transactions", transactions],
      ["#search-logs", logElement],
    ] as const) {
      const search = document.querySelector<HTMLInputElement>(selector)!;
      search.value = "sentinel";
      search.dispatchEvent(new realm.Event("input"));
      await element.ready();
    }
    document.querySelector<HTMLButtonElement>('[data-sort="date"]')!.click();
    await transactions.ready();
    expect(text(row.cells[2])).toBe(cellText);
    expect(row.cells[2].textContent).toBe(original);
    expect(text(code)).toBe(logText);
    expect(code.textContent).toBe(`${original}\r\n`);
    document
      .querySelector<HTMLButtonElement>("#download-transactions")!
      .click();
    document.querySelector<HTMLButtonElement>("#download-logs")!.click();
    expect(blob.mock.calls.map(([parts]) => parts[0])).toEqual([json, logs]);
    expect(await createObjectURL.mock.calls[0][0].text()).toBe(json);
    expect(
      Buffer.from(await createObjectURL.mock.calls[1][0].arrayBuffer()),
    ).toEqual(Buffer.from(logs));
    expect(payload.content.textContent).toBe(json);
  },
);

it.each([false, true])(
  "preserves and applies browser-restored transaction text after hydration (bundled=%s)",
  async (bundled) => {
    const page = await browser(bundled, "en-US", "Alpha second");
    const input = page.document.querySelector<HTMLInputElement>(
      "#search-transactions",
    )!;
    expect(input.value).toBe("Alpha second");
    expect(page.count.textContent).toBe("(1 of 5)");
    expect(page.rows()[0][2]).toBe("Alpha second");
    expect(page.matchedText()).toEqual(["Alpha second"]);
    for (const range of page.highlights.get("transactions-search")!) {
      expect(page.body.contains(range.startContainer)).toBe(true);
      expect(page.body.contains(range.endContainer)).toBe(true);
    }
    await page.search("");
    expect(page.body.rows).toHaveLength(5);
    expect(page.element.shadowRoot).toBeNull();
  },
);

it.each([false, true])(
  "server-renders and hydrates JSON-shaped Lit display objects as literal text (bundled=%s)",
  async (bundled) => {
    const value = JSON.parse(
      '{"_$litType$":1,"strings":["<b>untrusted</b><!--lit-part fake--><script>fetch(\\"https://example.invalid\\")</script>"],"values":[]}',
    );
    const original = transaction({
      description: value,
      date: value,
      status: value,
    });
    const originals = [{ ...original, companyId: value, accountNumber: value }];
    const output = renderReportTransactions([
      {
        companyId: value,
        result: {
          success: true,
          accounts: [{ accountNumber: value, txns: [original] }],
        },
      },
    ]);
    const realm = bundled ? createReportWindow() : window;
    const document = realm.document;
    document.body.innerHTML = output;
    expect(document.querySelectorAll("b, script")).toHaveLength(0);
    expect(document.querySelector("report-transactions")).not.toBeNull();
    expect(document.querySelector("template[shadowrootmode]")).toBeNull();
    const nodes = Array.from(
      document.querySelectorAll("tr, td, time, input, button"),
    );
    const payload =
      document.querySelector<HTMLTemplateElement>("#transactions-json")!;
    const json = payload.content.textContent;
    expect(JSON.parse(json!)).toEqual(originals);
    const fetch = jest.fn();
    const XMLHttpRequest = jest.fn();
    Object.assign(realm, {
      fetch,
      XMLHttpRequest,
      Highlight: Set,
      CSS: { highlights: new Map() },
    });
    if (bundled) realm.eval(reportClientScript);
    else await initializeTransactions(document, jest.fn());
    const element = document.querySelector<ReportTransactions>(
      "report-transactions",
    )!;
    await element.ready();
    Array.from(
      document.querySelectorAll("tr, td, time, input, button"),
    ).forEach((node, index) => expect(node).toBe(nodes[index]));
    expect(
      Array.from(document.querySelectorAll("td"), (cell) => cell.textContent),
    ).toEqual([
      "[object Object]",
      expect.any(String),
      ...Array(4).fill("[object Object]"),
    ]);
    const search = document.querySelector<HTMLInputElement>(
      "#search-transactions",
    )!;
    search.value = "[object Object]";
    search.dispatchEvent(new realm.Event("input"));
    await element.ready();
    document.querySelector<HTMLButtonElement>('[data-sort="account"]')!.click();
    await element.ready();
    expect(document.querySelectorAll("b, script")).toHaveLength(0);
    expect(document.querySelector("#transaction-count")!.textContent).toBe(
      "(1 of 1)",
    );
    expect(payload.content.textContent).toBe(json);
    expect(fetch).not.toHaveBeenCalled();
    expect(XMLHttpRequest).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "preserves restored log filters and original CRLF payload (bundled=%s)",
  async (bundled) => {
    const logs = "first\r\nsecond 😀\r\nthird\r";
    const realm = bundled ? createReportWindow() : window;
    const document = realm.document;
    document.body.innerHTML = renderReportLogs(logs);
    const search = document.querySelector<HTMLInputElement>("#search-logs")!;
    const code = document.querySelector("#run-logs code")!;
    search.value = "second ?";
    const highlights = new Map<string, Range[]>();
    const highlight = (name: string, ranges: Range[]) =>
      highlights.set(name, ranges);
    Object.assign(realm, {
      Highlight: Set,
      CSS: {
        highlights: {
          set: (name: string, ranges: Set<Range>) =>
            highlight(name, [...ranges]),
        },
      },
    });
    if (bundled) realm.eval(reportClientScript);
    else await initializeLogs(document, highlight);
    const element = document.querySelector<ReportLogs>("report-logs")!;
    await element.ready();
    expect(document.querySelector("#run-logs code")).toBe(code);
    expect(document.querySelector("#search-logs")).toBe(search);
    expect(search.value).toBe("second ?");
    expect(code.textContent).toBe("second 😀\r\n");
    expect(
      highlights.get("log-search")!.map((range) => range.toString()),
    ).toEqual(["second 😀"]);
    const payload = document.querySelector<HTMLTemplateElement>("#logs-json")!;
    expect(JSON.parse(payload.content.textContent!)).toBe(logs);
    search.value = "";
    search.dispatchEvent(new realm.Event("input"));
    await element.ready();
    expect(code.textContent).toBe(logs);
    expect(JSON.parse(payload.content.textContent!)).toBe(logs);
  },
);

it("reports asynchronous hydration failures and never reveals controls", async () => {
  const realm = createReportWindow();
  const document = realm.document;
  document.body.innerHTML = renderReportLogs("readable log");
  const payload = document.querySelector<HTMLTemplateElement>("#logs-json")!;
  payload.content.textContent = "not JSON";
  const errors: unknown[] = [];
  realm.addEventListener("error", (event) => {
    errors.push(event.error);
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = "Report error: " + event.error.name;
    document.body.prepend(message);
    event.preventDefault();
  });
  Object.assign(realm, { Highlight: Set, CSS: { highlights: new Map() } });
  realm.eval(reportClientScript);
  await expect(
    document.querySelector<ReportLogs>("report-logs")!.ready(),
  ).rejects.toThrow();
  await Promise.resolve();
  expect(errors).toHaveLength(1);
  expect(document.querySelector("[role=alert]")!.textContent).toBe(
    "Report error: SyntaxError",
  );
  expect(
    document.documentElement.classList.contains("report-interactive"),
  ).toBe(false);
  expect(document.querySelector("#run-logs code")!.textContent).toBe(
    "readable log",
  );
});

it.each([false, true])(
  "hydrates the server's en-GB dates, then localizes in the same rows and time nodes (bundled=%s)",
  async (bundled) => {
    const page = await browser(bundled, "en-US");
    expect(page.body.rows[0].cells[0].textContent).toBe("1/3/24");
    expect(page.body.rows[1].cells[0].textContent).toBe("1/1/24");
    await page.search("1/3/24");
    expect(page.body.rows).toHaveLength(1);
    expect(page.matchedText()).toEqual(["1/3/24"]);
  },
);

it("hydrates escaped marker-like input and exact CRLF logs without changing server nodes", async () => {
  const hostile =
    '<!--lit-part fake--><!--lit-node 0--><!--/lit-part--></template></script><img onerror="evil()">\r\n😀';
  const logs = `\r\n${hostile}\r\nlast\rlone\n`;
  const realm = createReportWindow();
  const document = realm.document;
  document.body.innerHTML =
    renderReportTransactions([
      {
        companyId: "max",
        result: {
          success: true,
          accounts: [
            {
              accountNumber: "123",
              txns: [transaction({ description: hostile })],
            },
          ],
        },
      },
    ] as AccountScrapeResult[]) + renderReportLogs(logs);
  const cell = document
    .querySelector("#transaction-rows")!
    .querySelectorAll("td")[2];
  const code = document.querySelector("#run-logs code")!;
  const text = Array.from(code.childNodes).find((node) => node.nodeType === 3)!;
  const payload =
    document.querySelector<HTMLTemplateElement>("#transactions-json")!;
  const originalJSON = payload.content.textContent;
  expect(cell.textContent).toBe(hostile);
  expect(code.textContent).toBe(logs);
  expect(document.querySelectorAll("img, script")).toHaveLength(0);
  const nodes = Array.from(
    document.querySelectorAll("tr, td, time, input, button, code"),
  );
  Object.assign(realm, {
    Highlight: Set,
    CSS: { highlights: new Map() },
  });
  realm.eval(reportClientScript);
  await Promise.all([
    document.querySelector<ReportTransactions>("report-transactions")!.ready(),
    document.querySelector<ReportLogs>("report-logs")!.ready(),
  ]);
  Array.from(
    document.querySelectorAll("tr, td, time, input, button, code"),
  ).forEach((node, index) => expect(node).toBe(nodes[index]));
  expect(code.contains(text)).toBe(true);
  expect(code.textContent).toBe(logs);
  expect(cell.textContent).toBe(hostile);
  expect(payload.content.textContent).toBe(originalJSON);
});

it("opens the native screenshot dialog using the selected preview image and caption", () => {
  const dialog = mock<HTMLDialogElement>();
  const image = mock<HTMLImageElement>();
  const caption = mock<HTMLElement>();
  const preview = mock<HTMLImageElement>({
    src: "data:image/png;base64,aGVsbG8=",
    alt: 'Failure <image> "caption"',
  });
  const button = mock<HTMLButtonElement>();
  button.querySelector.mockReturnValue(preview);
  const buttons = mock<NodeListOf<HTMLButtonElement>>();
  buttons.forEach.mockImplementation((callback) =>
    callback(button, 0, buttons),
  );
  const document = mock<Document>();
  document.querySelector.mockImplementation((id) =>
    id === "#screenshot-dialog"
      ? dialog
      : id === "#screenshot-full"
        ? image
        : caption,
  );
  document.querySelectorAll.mockReturnValue(buttons);
  initializeScreenshots(document);
  expect(dialog.showModal).not.toHaveBeenCalled();
  const click = button.addEventListener.mock.calls[0][1];
  if (typeof click !== "function")
    throw new Error("Missing screenshot listener");
  click.call(button, mock<Event>({ target: button }));
  expect(dialog.showModal).toHaveBeenCalledTimes(1);
  expect({
    src: image.src,
    alt: image.alt,
    caption: caption.textContent,
  }).toMatchSnapshot();
});

it.each(["date", "amount", "account"] as const)(
  "sorts %s both ways with stable original-order ties",
  async (key) => {
    const page = await browser();
    const index = ["date", "amount", "account"].indexOf(key);
    const orders = [page.rows().map((row) => row[2])];
    await page.sort(key);
    expect(page.headers[index].getAttribute("aria-sort")).toBe("ascending");
    orders.push(page.rows().map((row) => row[2]));
    await page.sort(key);
    orders.push(page.rows().map((row) => row[2]));
    expect(orders).toMatchSnapshot();
    expect(page.headers[index].getAttribute("aria-sort")).toBe("descending");
    expect(page.buttons[index].getAttribute("aria-label")).toBe(
      `Sort ${key} ascending`,
    );
  },
);

it.each([
  "01/01/2024",
  "visaCal",
  "acct10",
  "Beta ? <script> &",
  "100.00 EUR",
  "100.00 EUR*Alpha first*acct10",
  "pending",
  "SECRET_HIDDEN",
])("filters displayed columns using wildcard query %s", async (term) => {
  const page = await browser();
  await page.search(term);
  expect({
    count: page.count.textContent,
    rows: page.rows(),
    highlights: page.matchedText(),
  }).toMatchSnapshot();
  expect(page.highlights.get("log-search")).toHaveLength(1);
  if (page.rows().length)
    expect(page.highlights.get("transactions-search")!.length).toBeGreaterThan(
      0,
    );
});

it("executes the generated offline bundle with transaction rendering, filtering and sorting", async () => {
  const page = await browser(true);
  expect(page.body.rows).toHaveLength(page.originals.length);
  await page.search("alpha*");
  await page.sort("amount");
  expect({
    count: page.count.textContent,
    rows: page.rows(),
    highlights: page.matchedText(),
    timestamps: page.times
      .slice(0, page.originals.length)
      .map(({ dateTime, title }) => ({ dateTime, title })),
  }).toMatchSnapshot();
  expect(page.highlights.get("log-search")).toHaveLength(1);
  expect(page.fetch).not.toHaveBeenCalled();
  expect(page.XMLHttpRequest).not.toHaveBeenCalled();
  expect(
    page.document.querySelectorAll("[style], [onclick], [oninput], [onerror]"),
  ).toHaveLength(0);
  expect(
    page.document.documentElement.classList.contains("report-interactive"),
  ).toBe(true);
});

it.each([false, true])(
  "keeps live highlight text attached after filtering and toggling amount sort (bundled=%s)",
  async (bundled) => {
    const page = await browser(bundled);
    await page.search("alpha*");
    const second = ["Alpha second", "acct2", "max", "completed"];
    const tie = ["Alpha tie", "acct02", "visaCal", "completed"];
    const first = ["Alpha first", "acct10", "max", "completed"];
    for (const expected of [
      [second, tie, first],
      [first, second, tie],
    ]) {
      await page.sort("amount");
      expect(page.matchedText()).toEqual(expected.flat());
      for (const range of page.highlights.get("transactions-search")!) {
        expect(page.body.contains(range.startContainer)).toBe(true);
        expect(page.body.contains(range.endContainer)).toBe(true);
      }
    }
  },
);

it("retains accessible declarative controls and escapes hostile cell text across updates", async () => {
  const page = await browser();
  const search = page.document.querySelector("#search-transactions");
  await page.search("Beta ? <script> &");
  expect(page.body.querySelector("script")).toBeNull();
  expect(page.body.rows[0].cells[2].textContent).toBe("Beta 😀 <script> &");
  await page.sort("date");
  await page.sort("amount");
  await page.search("");
  expect(page.document.querySelector("#search-transactions")).toBe(search);
  expect(search?.getAttribute("aria-controls")).toBe("transaction-rows");
  expect(search?.getAttribute("aria-label")).toBe("Filter transactions");
  expect(page.count.getAttribute("aria-live")).toBe("polite");
  expect(Array.from(page.document.querySelectorAll("[data-sort]"))).toEqual(
    page.buttons,
  );
  expect(
    page.headers.map((header) => header.getAttribute("aria-sort")),
  ).toEqual(["none", "ascending", "none"]);
  expect(page.buttons.map((button) => button.title)).toEqual([
    "Sort date ascending",
    "Sort amount descending",
    "Sort account ascending",
  ]);
});

it("composes filters and sorts, clears only transaction highlights, and leaves original JSON untouched", async () => {
  const page = await browser();
  const json = page.payload.content.textContent;
  await page.search("alpha*");
  await page.sort("date");
  const filtered = { count: page.count.textContent, rows: page.rows() };
  await page.search("");
  expect({
    filtered,
    reset: { count: page.count.textContent, rows: page.rows() },
  }).toMatchSnapshot();
  expect(page.highlights.get("transactions-search")).toHaveLength(0);
  expect(page.highlights.get("log-search")).toHaveLength(1);
  expect(page.payload.content.textContent).toBe(json);
  expect(page.body.rows).toHaveLength(page.originals.length);
});
