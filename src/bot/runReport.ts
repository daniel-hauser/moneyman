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
      endedAt: Date;
    }
  | { state: "error"; message: string; endedAt: Date };

export interface RunReport {
  startedAt: Date;
  endedAt?: Date;
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

function clock(date: Date) {
  return `${date.toISOString().slice(11, 19)}Z`;
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
      return `${title} ✅ ${row.stats.added} added, ${(row.durationMs / 1000).toFixed(1)}s ${clock(row.endedAt)}`;
    case "error":
      return `${title} ❌ Failed ${clock(row.endedAt)}`;
  }
}

function renderStorage(name: string, row: StorageRow, withDetails: boolean) {
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
      details = [`\t${escapers.HTML(truncateError(row.message))}`];
      break;
  }

  return details.length ? `${header}\n${expandable(details)}` : header;
}

function render(report: RunReport, withStorageDetails: boolean) {
  const sections: Array<string> = [];

  if (report.summary) {
    sections.push(getSummaryMessages(report.summary.results));
    sections.push(blockquote("Status", renderScrape(report)));
  } else {
    sections.push(renderScrape(report).join("\n"));
  }

  const storages = [...report.storages].map(([name, row]) =>
    renderStorage(name, row, withStorageDetails),
  );
  if (storages.length) sections.push(storages.join("\n"));

  if (report.notices.length) {
    sections.push(report.notices.map((n) => escapers.HTML(n)).join("\n"));
  }
  if (report.endedAt) sections.push(`🏁 Finished ${clock(report.endedAt)}`);

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
  const full = render(report, true);
  if (full.length <= TELEGRAM_MESSAGE_LIMIT) return full;

  const compact = render(report, false);
  return compact.length <= TELEGRAM_MESSAGE_LIMIT
    ? compact
    : cutToLimit(compact);
}
