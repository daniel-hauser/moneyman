/** @jest-environment ./report/test-environment.cjs */
import { mock } from "jest-mock-extended";
import { runInNewContext } from "node:vm";
import { TransactionStatuses } from "israeli-bank-scrapers/lib/transactions.js";
import { transaction } from "../src/utils/tests.js";
import { initializeTransactions, initializeScreenshots } from "./client.js";
import { reportClientScript } from "../src/bot/report/assets.generated.js";
import type { ReportTransaction, SortKey } from "./transactions.js";

function browser(bundled = false) {
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
  const document = window.document.implementation.createHTMLDocument();
  document.body.innerHTML = `<template id="transactions-json"></template>
    <div><input id="search-transactions" type="search"></div>
    <span id="transaction-count" aria-live="polite"></span>
    <table><thead><tr>
      <th aria-sort="none">Date <button data-sort="date"></button></th>
      <th aria-sort="none">Amount <button data-sort="amount"></button></th>
      <th aria-sort="none">Account <button data-sort="account"></button></th>
    </tr></thead><tbody id="transaction-rows"><tr><td>SSR fallback</td></tr></tbody></table>`;
  const payload =
    document.querySelector<HTMLTemplateElement>("#transactions-json")!;
  payload.content.append(
    document.createTextNode(
      JSON.stringify(
        originals.map((row) => ({ ...row, memo: "SECRET_HIDDEN" })),
      ),
    ),
  );
  const body =
    document.querySelector<HTMLTableSectionElement>("#transaction-rows")!;
  const count = document.querySelector<HTMLElement>("#transaction-count")!;
  const keys: SortKey[] = ["date", "amount", "account"];
  const headers = Array.from(document.querySelectorAll("th"));
  const highlights = new Map<string, Range[]>([
    ["log-search", [mock<Range>()]],
  ]);
  const highlight = jest.fn((name: string, ranges: Range[]) =>
    highlights.set(name, ranges),
  );
  const formatter = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeZone: "UTC",
  });
  jest.spyOn(Intl, "DateTimeFormat").mockImplementation(() => formatter);
  const fetch = jest.fn();
  const XMLHttpRequest = jest.fn();
  if (bundled) {
    runInNewContext(reportClientScript, {
      document,
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
  } else {
    initializeTransactions(document, highlight);
  }

  const search = document.querySelector<HTMLInputElement>(
    "#search-transactions",
  )!;
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-sort]"),
  );
  const times = Array.from(body.querySelectorAll("time")).map(
    (time) => time.cloneNode(true) as HTMLTimeElement,
  );
  return {
    document,
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
    search(term: string) {
      search.value = term;
      search.dispatchEvent(new Event("input", { bubbles: true }));
    },
    sort(key: SortKey) {
      buttons[keys.indexOf(key)].click();
    },
  };
}

afterEach(() => jest.restoreAllMocks());

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
  (key) => {
    const page = browser();
    const index = ["date", "amount", "account"].indexOf(key);
    const orders = [page.rows().map((row) => row[2])];
    page.sort(key);
    expect(page.headers[index].getAttribute("aria-sort")).toBe("ascending");
    orders.push(page.rows().map((row) => row[2]));
    page.sort(key);
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
])("filters displayed columns using wildcard query %s", (term) => {
  const page = browser();
  page.search(term);
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

it("executes the generated offline bundle with transaction rendering, filtering and sorting", () => {
  const page = browser(true);
  expect(page.body.rows).toHaveLength(page.originals.length);
  page.search("alpha*");
  page.sort("amount");
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
  (bundled) => {
    const page = browser(bundled);
    page.search("alpha*");
    const second = ["Alpha second", "acct2", "max", "completed"];
    const tie = ["Alpha tie", "acct02", "visaCal", "completed"];
    const first = ["Alpha first", "acct10", "max", "completed"];
    for (const expected of [
      [second, tie, first],
      [first, second, tie],
    ]) {
      page.sort("amount");
      expect(page.matchedText()).toEqual(expected.flat());
      for (const range of page.highlights.get("transactions-search")!) {
        expect(page.body.contains(range.startContainer)).toBe(true);
        expect(page.body.contains(range.endContainer)).toBe(true);
      }
    }
  },
);

it("retains accessible declarative controls and escapes hostile cell text across updates", () => {
  const page = browser();
  const search = page.document.querySelector("#search-transactions");
  page.search("Beta ? <script> &");
  expect(page.body.querySelector("script")).toBeNull();
  expect(page.body.rows[0].cells[2].textContent).toBe("Beta 😀 <script> &");
  page.sort("date");
  page.sort("amount");
  page.search("");
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

it("composes filters and sorts, clears only transaction highlights, and leaves original JSON untouched", () => {
  const page = browser();
  const json = page.payload.content.textContent;
  page.search("alpha*");
  page.sort("date");
  const filtered = { count: page.count.textContent, rows: page.rows() };
  page.search("");
  expect({
    filtered,
    reset: { count: page.count.textContent, rows: page.rows() },
  }).toMatchSnapshot();
  expect(page.highlights.get("transactions-search")).toHaveLength(0);
  expect(page.highlights.get("log-search")).toHaveLength(1);
  expect(page.payload.content.textContent).toBe(json);
  expect(page.body.rows).toHaveLength(page.originals.length);
});
