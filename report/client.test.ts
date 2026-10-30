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
  const payload = mock<HTMLTemplateElement>({
    content: {
      textContent: JSON.stringify(
        originals.map((row) => ({ ...row, memo: "SECRET_HIDDEN" })),
      ),
    },
  });
  const body = mock<HTMLTableSectionElement>();
  const search = mock<HTMLInputElement>({ value: "" });
  const count = mock<HTMLElement>();
  const document = mock<Document>();
  document.querySelector.mockImplementation((selector) => {
    if (selector === "#transactions-json") return payload;
    if (selector === "#transaction-rows") return body;
    if (selector === "#search-transactions") return search;
    if (selector === "#transaction-count") return count;
    return null;
  });
  const keys: SortKey[] = ["date", "amount", "account"];
  const headers = keys.map(() => mock<HTMLTableCellElement>());
  const buttons = keys.map((sort, index) => {
    const button = mock<HTMLButtonElement>({ dataset: { sort } });
    button.closest.mockReturnValue(headers[index]);
    return button;
  });
  const list = mock<NodeListOf<HTMLButtonElement>>();
  list.forEach.mockImplementation((callback) => {
    buttons.forEach((button, index) => callback(button, index, list));
  });
  document.querySelectorAll.mockImplementation((selector) =>
    selector === "[data-sort]" ? list : mock<NodeListOf<Element>>(),
  );
  const times: HTMLTimeElement[] = [];
  document.createElement.mockImplementation((tag) => {
    if (tag === "time") {
      const time = mock<HTMLTimeElement>();
      times.push(time);
      return time;
    }
    return mock<HTMLElement>();
  });
  document.createDocumentFragment.mockImplementation(() =>
    mock<DocumentFragment>(),
  );
  document.createRange.mockImplementation(() => mock<Range>());
  let pending: string[] = [];
  let displayed: string[][] = [];
  document.createTextNode.mockImplementation((textContent) => {
    pending.push(textContent);
    return mock<Text>({ textContent });
  });
  body.replaceChildren.mockImplementation(() => {
    displayed = [];
    for (let index = 0; index < pending.length; index += 6)
      displayed.push(pending.slice(index, index + 6));
    pending = [];
  });
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
  if (bundled) {
    runInNewContext(reportClientScript, {
      document,
      Intl,
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

  function fire(element: typeof search | (typeof buttons)[number]) {
    const listener = element.addEventListener.mock.calls[0][1];
    if (typeof listener !== "function")
      throw new Error("Missing browser listener");
    listener.call(element, mock<Event>({ target: element }));
  }
  return {
    originals,
    payload,
    count,
    highlights,
    headers,
    buttons,
    body,
    times,
    rows: () => displayed,
    matchedText: () =>
      (highlights.get("transactions-search") ?? []).map((range) => {
        const [[node, start]] = jest.mocked(range.setStart).mock.calls;
        const [[, end]] = jest.mocked(range.setEnd).mock.calls;
        return node.textContent?.slice(start, end);
      }),
    search(term: string) {
      search.value = term;
      fire(search);
    },
    sort(key: SortKey) {
      fire(buttons[keys.indexOf(key)]);
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
    const orders = [page.rows().map((row) => row[3])];
    page.sort(key);
    expect(page.headers[index].setAttribute).toHaveBeenLastCalledWith(
      "aria-sort",
      "ascending",
    );
    orders.push(page.rows().map((row) => row[3]));
    page.sort(key);
    orders.push(page.rows().map((row) => row[3]));
    expect(orders).toMatchSnapshot();
    expect(page.headers[index].setAttribute).toHaveBeenLastCalledWith(
      "aria-sort",
      "descending",
    );
    expect(page.buttons[index].setAttribute).toHaveBeenLastCalledWith(
      "aria-label",
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
  expect(page.body.replaceChildren).toHaveBeenCalledTimes(1);
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
  expect(page.body.replaceChildren).toHaveBeenCalledTimes(4);
});
