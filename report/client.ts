import "../src/bot/report/interactive.js";
import type {
  ReportTransactions,
  ReportLogs,
} from "../src/bot/report/interactive.js";
import type { Highlighter } from "../src/bot/report/light-element.js";

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

export async function initializeTransactions(
  document: Document,
  highlight?: Highlighter,
) {
  const element = document.querySelector<ReportTransactions>(
    "report-transactions",
  );
  if (!element) return;
  if (highlight) element.highlight = highlight;
  await element.ready();
}

export async function initializeLogs(
  document: Document,
  highlight?: Highlighter,
) {
  const element = document.querySelector<ReportLogs>("report-logs");
  if (!element) return;
  if (highlight) element.highlight = highlight;
  await element.ready();
}

export function initializeScreenshots(document: Document) {
  const dialog =
    document.querySelector<HTMLDialogElement>("#screenshot-dialog");
  const image = document.querySelector<HTMLImageElement>("#screenshot-full");
  const caption = document.querySelector<HTMLElement>(
    "#screenshot-full-caption",
  );
  const size = document.querySelector<HTMLElement>("#screenshot-full-size");
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
        if (size) size.textContent = button.dataset.size ?? "Size unavailable";
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
  return source.hasAttribute("data-json")
    ? JSON.parse(content ?? '""')
    : content;
}

export async function initializeReport(document: Document) {
  initializeStarted(document);
  await Promise.all([
    initializeTransactions(document),
    initializeLogs(document),
  ]);
  initializeScreenshots(document);
  initializeDownloads(document);
}
