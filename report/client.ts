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
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-sort]");
  let sorting: { key: SortKey; direction: Direction } | undefined;

  const render = () => {
    const term = search.value;
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
    const fragment = document.createDocumentFragment();
    const ranges: Range[] = [];
    for (const view of ordered) {
      const row = document.createElement("tr");
      let offset = 0;
      for (const [index, value] of view.cells.entries()) {
        const cell = document.createElement("td");
        const node = document.createTextNode(value);
        const spans = (matchesByIndex.get(view.index) ?? [])
          .map(([start, end]): Span => [
            Math.max(0, start - offset),
            Math.min(value.length, end - offset),
          ])
          .filter(([start, end]) => end > start);
        if (index === 0) {
          const time = document.createElement("time");
          time.className = "transaction-date";
          time.dateTime = view.transaction.date;
          time.title = view.transaction.date;
          time.append(node);
          cell.append(time);
        } else {
          cell.append(node);
        }
        for (const range of rangesFor(document, node, spans))
          ranges.push(range);
        row.append(cell);
        offset += value.length + 1;
      }
      fragment.append(row);
    }
    body.replaceChildren(fragment);
    count.textContent = term
      ? `(${ordered.length} of ${views.length})`
      : `(${views.length})`;
    highlight("transactions-search", ranges);
  };

  search.addEventListener("input", render);
  buttons.forEach((button) => {
    const key = button.dataset.sort;
    if (key !== "date" && key !== "amount" && key !== "account") return;
    button.addEventListener("click", () => {
      const direction =
        sorting?.key === key && sorting.direction === "ascending"
          ? "descending"
          : "ascending";
      sorting = { key, direction };
      buttons.forEach((other) => {
        const active = other === button;
        other
          .closest("th")
          ?.setAttribute("aria-sort", active ? direction : "none");
        const next =
          active && direction === "ascending" ? "descending" : "ascending";
        const label = `Sort ${other.dataset.sort} ${next}`;
        other.setAttribute("aria-label", label);
        other.title = label;
      });
      render();
    });
  });
  render();
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
  search.addEventListener("input", () => {
    const term = search.value;
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
    const node = document.createTextNode(term ? parts.join("") : logs);
    code.replaceChildren(node);
    highlight("log-search", rangesFor(document, node, spans));
  });
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
