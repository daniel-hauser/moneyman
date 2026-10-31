import { html, render, type TemplateResult } from "lit-html";
import { compilePattern, matchPattern, type Span } from "./wildcard.js";
import {
  transactionView,
  sortTransactions,
  type Direction,
  type ReportTransaction,
  type SortKey,
} from "./transactions.js";

type Highlighter = (name: string, ranges: Range[]) => void;

function setHighlights(name: string, ranges: Range[]) {
  const highlight = new Highlight();
  for (const range of ranges) highlight.add(range);
  CSS.highlights.set(name, highlight);
}

function rangesFor(document: Document, node: Text, spans: Span[]) {
  return spans.map(([start, end]) => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  });
}

function replaceControl(element: Element) {
  // Separate Lit roots preserve the surrounding server-rendered shell.
  const anchor = element.ownerDocument.createComment("");
  const parent = element.parentElement!;
  element.replaceWith(anchor);
  return (template: TemplateResult) =>
    render(template, parent, { renderBefore: anchor });
}

function searchControl(
  id: string,
  label: string,
  controls: string,
  onInput: (event: Event) => void,
) {
  return html`<input
    id=${id}
    class="report-search interactive"
    type="search"
    aria-label=${label}
    aria-controls=${controls}
    placeholder="Filter: * any text, ? one character"
    title="Case-insensitive: * any text, ? one character; ~* literal *, ~? literal ?, ~~ literal ~."
    @input=${onInput}
  />`;
}

function sortControl(key: SortKey, label: string, onClick: () => void) {
  return html`<button
    type="button"
    class="sort-button interactive"
    data-sort=${key}
    aria-label=${label}
    title=${label}
    @click=${onClick}
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      aria-hidden="true"
      focusable="false"
    >
      <use href="#sort-icon" />
    </svg>
  </button>`;
}

function textNode(element: Element) {
  return Array.from(element.childNodes).find(
    (node): node is Text => node.nodeType === 3,
  );
}

export function initializeStarted(document: Document) {
  const time = document.querySelector<HTMLTimeElement>("#run-started");
  if (!time) return;
  const date = new Date(time.dateTime);
  if (!Number.isNaN(date.getTime())) {
    time.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  }
}

export function initializeTransactions(
  document: Document,
  highlight: Highlighter = setHighlights,
) {
  const payload =
    document.querySelector<HTMLTemplateElement>("#transactions-json");
  const body =
    document.querySelector<HTMLTableSectionElement>("#transaction-rows");
  const search = document.querySelector<HTMLInputElement>(
    "#search-transactions",
  );
  const count = document.querySelector<HTMLElement>("#transaction-count");
  if (!payload || !body || !search || !count) return;
  const transactions: ReportTransaction[] = JSON.parse(
    payload.content.textContent ?? "[]",
  );
  const formatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeZone: "UTC",
  });
  const views = transactions.map((transaction, index) =>
    transactionView(transaction, index, formatter),
  );
  const controls = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-sort]"),
  ).flatMap((button) => {
    const key = button.dataset.sort;
    if (key !== "date" && key !== "amount" && key !== "account") return [];
    return [
      {
        key: key as SortKey,
        header: button.closest("th"),
        update: replaceControl(button),
      },
    ];
  });
  let sorting: { key: SortKey; direction: Direction } | undefined;
  let term = search.value;
  body.replaceChildren();
  count.replaceChildren();

  const update = () => {
    const tokens = compilePattern(term);
    const matches = views
      .map((view) => ({
        view,
        match: term
          ? matchPattern(view.cells.join(" "), tokens)
          : { matched: true, spans: [] },
      }))
      .filter(({ match }) => match.matched);
    const ordered = sorting
      ? sortTransactions(
          matches.map(({ view }) => view),
          sorting.key,
          sorting.direction,
        )
      : matches.map(({ view }) => view);
    const matchesByIndex = new Map(
      matches.map(({ view, match }) => [view.index, match.spans]),
    );
    render(
      ordered.map(
        (view) =>
          html`<tr>
            ${view.cells.map((value, index) => {
              const content =
                index === 0
                  ? html`<time
                      class="transaction-date"
                      datetime=${view.transaction.date}
                      title=${view.transaction.date}
                      >${value}</time
                    >`
                  : value;
              return html`<td>${content}</td>`;
            })}
          </tr>`,
      ),
      body,
    );
    const ranges: Range[] = [];
    for (const [rowIndex, view] of ordered.entries()) {
      const row = body.rows[rowIndex];
      let offset = 0;
      for (const [index, value] of view.cells.entries()) {
        const cell = row.cells[index];
        const node = textNode(cell.querySelector("time") ?? cell);
        const spans = (matchesByIndex.get(view.index) ?? [])
          .map(([start, end]): Span => [
            Math.max(0, start - offset),
            Math.min(value.length, end - offset),
          ])
          .filter(([start, end]) => end > start);
        if (node) ranges.push(...rangesFor(document, node, spans));
        offset += value.length + 1;
      }
    }
    render(
      term ? `(${ordered.length} of ${views.length})` : `(${views.length})`,
      count,
    );
    highlight("transactions-search", ranges);
    controls.forEach(({ key, header, update: updateControl }) => {
      const direction = sorting?.key === key ? sorting.direction : "none";
      header?.setAttribute("aria-sort", direction);
      const next = direction === "ascending" ? "descending" : "ascending";
      updateControl(
        sortControl(key, `Sort ${key} ${next}`, () => {
          sorting = { key, direction: next };
          update();
        }),
      );
    });
  };

  replaceControl(search)(
    searchControl(
      "search-transactions",
      "Filter transactions",
      "transaction-rows",
      (event) => {
        term = (event.currentTarget as HTMLInputElement).value;
        update();
      },
    ),
  );
  update();
}

export function initializeLogs(
  document: Document,
  highlight: Highlighter = setHighlights,
) {
  const code = document.querySelector<HTMLElement>("#run-logs code");
  const search = document.querySelector<HTMLInputElement>("#search-logs");
  if (!code || !search) return;
  const logs = code.textContent ?? "";
  const lines = logs.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  code.replaceChildren();
  render(logs, code);
  replaceControl(search)(
    searchControl("search-logs", "Filter logs", "run-logs", (event) => {
      const term = (event.currentTarget as HTMLInputElement).value;
      const parts: string[] = [];
      const spans: Span[] = [];
      let length = 0;
      if (term) {
        const tokens = compilePattern(term);
        for (const line of lines) {
          const match = matchPattern(line.replace(/[\r\n]+$/, ""), tokens);
          if (!match.matched) continue;
          parts.push(line);
          for (const [start, end] of match.spans)
            spans.push([length + start, length + end]);
          length += line.length;
        }
      }
      render(term ? parts.join("") : logs, code);
      const node = textNode(code);
      highlight("log-search", node ? rangesFor(document, node, spans) : []);
    }),
  );
}

export function initializeScreenshots(document: Document) {
  const dialog =
    document.querySelector<HTMLDialogElement>("#screenshot-dialog");
  const image = document.querySelector<HTMLImageElement>("#screenshot-full");
  const caption = document.querySelector<HTMLElement>(
    "#screenshot-full-caption",
  );
  if (!dialog || !image || !caption) return;
  document
    .querySelectorAll<HTMLButtonElement>(".screenshot-open")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const preview = button.querySelector("img");
        if (!preview) return;
        image.src = preview.src;
        image.alt = preview.alt;
        caption.textContent = preview.alt;
        dialog.showModal();
      });
    });
}

export function initializeDownloads(document: Document) {
  document
    .querySelectorAll<HTMLButtonElement>("[data-download]")
    .forEach((button) => {
      const source = document.getElementById(button.dataset.download ?? "");
      if (!source) return;
      const content = downloadContent(source);
      button.addEventListener("click", () => {
        const url = URL.createObjectURL(
          new Blob([content ?? ""], { type: button.dataset.type }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = button.dataset.filename ?? "";
        document.body.appendChild(link);
        try {
          link.click();
        } finally {
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        }
      });
    });
}

function downloadContent(source: HTMLElement | HTMLTemplateElement) {
  return "content" in source ? source.content.textContent : source.textContent;
}

export function initializeReport(document: Document) {
  initializeStarted(document);
  initializeTransactions(document);
  initializeLogs(document);
  initializeScreenshots(document);
  initializeDownloads(document);
}
