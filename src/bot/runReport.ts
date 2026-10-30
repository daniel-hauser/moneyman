import { escapers } from "@telegraf/entity";
import type { AccountScrapeResult } from "../types.js";
import { blockquote, getSummaryMessages } from "./messages.js";
import { hashInlineContent, html } from "./report/html.js";
import {
  renderReportAccounts,
  renderReportErrors,
  renderReportScreenshots,
  renderReportRunDetails,
  renderReportStorages,
  renderReportTransactions,
  renderReportLogs,
} from "./report/components.js";
import { reportClientScript, reportStyles } from "./report/assets.generated.js";
import { statsDetailsLines, type SaveStats } from "./saveStats.js";
import { truncateError } from "./truncateError.js";

export const TELEGRAM_MESSAGE_LIMIT = 4096;

export interface Step {
  name: string;
  /** Unset while the step is running */
  durationMs?: number;
}

export type StorageRow =
  | { state: "saving"; steps: Array<Step> }
  | {
      state: "done";
      stats: SaveStats;
      durationMs: number;
      steps: Array<Step>;
    }
  | { state: "error"; message: string };

export interface RunReport {
  startedAt: Date;
  failed: boolean;
  scrape: { status: Array<string>; totalTimeSec?: number };
  summary?: { results: Array<AccountScrapeResult> };
  errors: Array<{ caller: string; message: string }>;
  screenshots: Array<{ caption: string; dataUrl: string }>;
  /** Keyed by storage name, ordered by insertion */
  storages: Record<string, StorageRow>;
  /** Free-form notes, e.g. "No transactions found, skipping save" */
  notices: Array<string>;
}

export function createRunReport(startedAt = new Date()): RunReport {
  return {
    startedAt,
    failed: false,
    scrape: { status: ["Starting..."] },
    errors: [],
    screenshots: [],
    storages: {},
    notices: [],
  };
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

  const stepLines = (steps: Array<Step>) =>
    steps.map(
      (s) =>
        `\t${escapers.HTML(s.durationMs === undefined ? s.name : `${s.name}, took ${(s.durationMs / 1000).toFixed(2)}s`)}`,
    );
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

  return details.length
    ? `${header}\n${blockquote(undefined, details)}`
    : header;
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

  const storages = Object.entries(report.storages).map(([name, row]) =>
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

/** The whole report with nothing shortened or dropped */
export function renderFullReport(report: RunReport): string {
  return render(report, { details: true, full: true });
}

export function renderHTMLReport(report: RunReport, logs?: string): string {
  const failed =
    report.failed ||
    Object.values(report.storages).some((row) => row.state === "error") ||
    Boolean(report.summary?.results.some(({ result }) => !result.success));
  const transactions = report.summary
    ? renderReportTransactions(report.summary.results)
    : "";
  const screenshots = renderReportScreenshots(report.screenshots);
  // Approve only static application code, never rendered report or log data.
  const policy = [
    "default-src 'none'",
    `script-src ${hashInlineContent(reportClientScript)}`,
    "script-src-attr 'none'",
    `style-src ${hashInlineContent(reportStyles)}`,
    "style-src-attr 'none'",
    "img-src data:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join("; ");

  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="Content-Security-Policy" content="${policy}" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Moneyman run report</title>
        ${`<style>${reportStyles}</style>`}
      </head>
      <body>
        <svg
          class="report-icons"
          width="0"
          height="0"
          aria-hidden="true"
          focusable="false"
        >
          <symbol id="download-icon" viewBox="0 0 24 24">
            <path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5" />
          </symbol>
          <symbol id="sort-icon" viewBox="0 0 24 24">
            <path d="m8 3-4 4m4-4 4 4M8 3v18m8 0-4-4m4 4 4-4m-4 4V3" />
          </symbol>
        </svg>
        <h1>Moneyman run report</h1>
        ${renderReportRunDetails({
          startedAt: report.startedAt,
          failed,
          ...report.scrape,
        })}
        ${renderReportAccounts(report.summary?.results ?? [], screenshots)}
        ${transactions} ${renderReportStorages(report.storages)}
        ${renderReportErrors(report.errors)}${logs === undefined ? "" : renderReportLogs(logs)}
        <footer class="report-footer">
          <a
            href="https://github.com/daniel-hauser/moneyman"
            target="_blank"
            rel="noopener noreferrer"
            >daniel-hauser/moneyman</a
          >
          <span aria-hidden="true">&middot;</span>
          <a
            href="https://moneyman.co.il/"
            target="_blank"
            rel="noopener noreferrer"
            >moneyman.co.il</a
          >
        </footer>
        ${`<script>${reportClientScript}</script>`}
      </body>
    </html>`;
}
