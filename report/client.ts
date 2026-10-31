import { render } from "lit-html";
import { hydrate } from "@lit-labs/ssr-client";
import {
  transactionsTemplate,
  logsTemplate,
  type Sorting,
} from "../src/bot/report/interactive.js";
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
  const root = document.querySelector<HTMLElement>("#transactions-ui");
  const body =
    document.querySelector<HTMLTableSectionElement>("#transaction-rows");
  const search = document.querySelector<HTMLInputElement>(
    "#search-transactions",
  );
  const count = document.querySelector<HTMLElement>("#transaction-count");
  if (!payload || !root || !body || !search || !count) return;
  const transactions: ReportTransaction[] = JSON.parse(
    payload.content.textContent ?? "[]",
  );
  const serverFormatter = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "short",
    timeZone: "UTC",
  });
  let views = transactions.map((transaction, index) =>
    transactionView(transaction, index, serverFormatter),
  );
  let sorting: Sorting | undefined;
  let term = "";

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
    render(template(ordered), root);
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
    highlight("transactions-search", ranges);
  };

  const template = (ordered: typeof views) =>
    transactionsTemplate(
      ordered,
      views.length,
      term,
      sorting,
      (event) => {
        term = (event.currentTarget as HTMLInputElement).value;
        update();
      },
      (key: SortKey, direction: Direction) => {
        sorting = { key, direction };
        update();
      },
    );
  // Hydrate with the server's exact display values before localizing dates.
  hydrate(template(views), root);
  const formatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeZone: "UTC",
  });
  views = transactions.map((transaction, index) =>
    transactionView(transaction, index, formatter),
  );
  update();
}

export function initializeLogs(
  document: Document,
  highlight: Highlighter = setHighlights,
) {
  const code = document.querySelector<HTMLElement>("#run-logs code");
  const root = document.querySelector<HTMLElement>("#logs-ui");
  const payload = document.querySelector<HTMLTemplateElement>("#logs-json");
  if (!code || !root || !payload) return;
  const logs: string = JSON.parse(payload.content.textContent ?? '""');
  const lines = logs.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  const onInput = (event: Event) => {
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
    render(logsTemplate(term ? parts.join("") : logs, onInput), root);
    const node = textNode(code);
    highlight("log-search", node ? rangesFor(document, node, spans) : []);
  };
  hydrate(logsTemplate(logs, onInput), root);
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
  const content =
    "content" in source ? source.content.textContent : source.textContent;
  return source.id === "logs-json" ? JSON.parse(content ?? '""') : content;
}

export function initializeReport(document: Document) {
  initializeStarted(document);
  initializeTransactions(document);
  initializeLogs(document);
  initializeScreenshots(document);
  initializeDownloads(document);
}
