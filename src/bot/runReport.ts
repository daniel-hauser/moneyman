import { escapers } from "@telegraf/entity";
import type { AccountScrapeResult } from "../types.js";
import type { Timer } from "../utils/Timer.js";
import { blockquote, getSummaryMessages } from "./messages.js";
import { statsDetailsLines, type SaveStats } from "./saveStats.js";
import { truncateError } from "./truncateError.js";

export const TELEGRAM_MESSAGE_LIMIT = 4096;

export type StorageRow =
  | { state: "saving"; steps: Array<Timer> }
  | {
      state: "done";
      stats: SaveStats;
      durationMs: number;
      steps: Array<Timer>;
    }
  | { state: "error"; message: string };

export interface RunReport {
  startedAt: Date;
  scrape: { status: Array<string>; totalTimeSec?: number };
  summary?: { results: Array<AccountScrapeResult> };
  /** Ordered by insertion */
  storages: Map<string, StorageRow>;
  /** Free-form notes, e.g. "No transactions found, skipping save" */
  notices: Array<string>;
}

export function createRunReport(startedAt = new Date()): RunReport {
  return {
    startedAt,
    scrape: { status: ["Starting..."] },
    storages: new Map(),
    notices: [],
  };
}

function expandable(lines: Array<string>) {
  return `<blockquote expandable>${lines.join("\n")}</blockquote>`;
}

function renderScrape(report: RunReport) {
  const { status, totalTimeSec } = report.scrape;
  const lines = status.map((s) => escapers.HTML(s));
  if (totalTimeSec) {
    lines.push("", `Total time: ${totalTimeSec.toFixed(1)} seconds`);
  }
  return lines;
}

function storageHeader(name: string, row: StorageRow, stats?: SaveStats) {
  const table = stats?.table ? ` (${stats.table})` : "";
  const title = `📝 ${escapers.HTML(name)}${escapers.HTML(table)}`;
  switch (row.state) {
    case "saving":
      return `${title} ⏳ Saving...`;
    case "done":
      return title;
    case "error":
      return `${title} ❌ Failed`;
  }
}

function renderStorage(
  name: string,
  row: StorageRow,
  { details: withDetails, full }: RenderMode,
) {
  const header = storageHeader(
    name,
    row,
    row.state === "done" ? row.stats : undefined,
  );
  if (!withDetails) return header;

  const stepLines = (steps: Array<Timer>) =>
    steps.map((s) => `\t${escapers.HTML(String(s))}`);
  let details: Array<string>;
  switch (row.state) {
    case "saving":
      details = stepLines(row.steps);
      break;
    case "done":
      details = [
        ...stepLines(row.steps),
        ...statsDetailsLines(row.stats, row.durationMs),
      ];
      break;
    case "error":
      details = [
        `\t${escapers.HTML(full ? row.message : truncateError(row.message))}`,
      ];
      break;
  }

  return details.length ? `${header}\n${expandable(details)}` : header;
}

interface RenderMode {
  /** Include the per-storage detail blocks */
  details: boolean;
  /** Apply no caps */
  full: boolean;
}

function render(report: RunReport, mode: RenderMode) {
  const sections: Array<string> = [];

  if (report.summary) {
    sections.push(
      getSummaryMessages(report.summary.results, { full: mode.full }),
    );
    sections.push(blockquote("Status", renderScrape(report)));
  } else {
    sections.push(renderScrape(report).join("\n"));
  }

  const storages = [...report.storages].map(([name, row]) =>
    renderStorage(name, row, mode),
  );
  if (storages.length) sections.push(storages.join("\n"));

  if (report.notices.length) {
    sections.push(report.notices.map((n) => escapers.HTML(n)).join("\n"));
  }

  return sections.filter(Boolean).join("\n\n").trim();
}

/** Cut at a line boundary and close any blockquote left open */
function cutToLimit(text: string) {
  const lines = text.split("\n");
  const kept: Array<string> = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > TELEGRAM_MESSAGE_LIMIT - 40) break;
    kept.push(line);
    length += line.length + 1;
  }
  let result = kept.join("\n");
  const opened = result.split("<blockquote").length;
  const closed = result.split("</blockquote>").length;
  if (opened > closed) result += "</blockquote>";
  return `${result}\n…`;
}

/** Render the report as a Telegram HTML message. Pure. */
export function renderRunReport(report: RunReport): string {
  const capped = render(report, { details: true, full: false });
  if (capped.length <= TELEGRAM_MESSAGE_LIMIT) return capped;

  const compact = render(report, { details: false, full: false });
  return compact.length <= TELEGRAM_MESSAGE_LIMIT
    ? compact
    : cutToLimit(compact);
}

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&amp;": "&",
};

/** Convert the report HTML to plain text */
export function htmlToText(html: string): string {
  // Repeat until stable so nested/malformed tags like "<<script>script>" can't survive
  let text = html;
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  } while (text !== previous);

  // Decode last and in a single pass so decoded text is never re-processed
  return text.replace(/&(?:lt|gt|quot|amp);/g, (entity) => ENTITIES[entity]);
}

/** The whole report as plain text, with nothing shortened or dropped */
export function renderFullReportText(report: RunReport): string {
  return htmlToText(render(report, { details: true, full: true }));
}

/** Whether the message sent to Telegram differs from the full report */
export function isReportTruncated(report: RunReport): boolean {
  return htmlToText(renderRunReport(report)) !== renderFullReportText(report);
}
