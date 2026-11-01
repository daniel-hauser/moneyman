import { escapers } from "@telegraf/entity";
import { Buffer } from "node:buffer";
import { render } from "@lit-labs/ssr";
import { collectResultSync } from "@lit-labs/ssr/lib/render-result.js";
import type { AccountScrapeResult, RunTiming } from "../../types.js";
import type { StorageRow } from "../runReport.js";
import { html } from "./html.js";
import { html as litHtml } from "lit";
import { renderLight } from "@lit-labs/ssr-client/directives/render-light.js";
import "./interactive.js";
import { ReportLightRenderer } from "./light-renderer.js";

const escaped = (value: string | number) =>
  escapers.HTML(String(value)).replaceAll('"', "&quot;");

function renderErrorDetails(summary: string, message: string) {
  const escapedMessage = escaped(message);
  return html`<details>
    <summary>${escaped(summary)}</summary>
    <pre class="error-message">${escapedMessage}</pre>
  </details>`;
}

export function renderReportRunDetails({
  startedAt,
  totalTimeSec,
}: {
  startedAt: Date;
  totalTimeSec?: number;
}) {
  return html`<dl class="run-details">
    <div>
      <dt>Started</dt>
      <dd>
        <time
          id="run-started"
          datetime="${startedAt.toISOString()}"
          title="${startedAt.toISOString()}"
          >${escaped(startedAt.toISOString())}</time
        >
      </dd>
    </div>
    ${
      totalTimeSec === undefined
        ? ""
        : html`<div>
            <dt>Scraper time</dt>
            <dd>${totalTimeSec.toFixed(1)} seconds</dd>
          </div>`
    }
  </dl>`;
}

export function renderReportTimings(
  timings: readonly RunTiming[] | undefined,
  startedAt: Date,
  endedAt?: Date,
) {
  if (!timings?.length) return "";

  const start = startedAt.getTime();
  const currentEnd = endedAt?.getTime() ?? Date.now();
  const end = Math.max(
    start,
    endedAt?.getTime() ?? start,
    ...timings.map((timing) => timing.endedAt ?? currentEnd),
  );
  const totalMs = end - start;
  const scale = totalMs || 1;
  const duration = (ms: number) =>
    ms < 1000
      ? `${Number(ms.toFixed(1))} ms`
      : `${Number((ms / 1000).toFixed(2))} s`;
  const children = new Map<string, RunTiming[]>();
  const ids = new Set(timings.map(({ id }) => id));
  for (const timing of timings) {
    if (timing.parentId && ids.has(timing.parentId)) {
      const siblings = children.get(timing.parentId) ?? [];
      siblings.push(timing);
      children.set(timing.parentId, siblings);
    }
  }
  const rows = timings
    .filter(({ parentId }) => !parentId || !ids.has(parentId))
    .sort((a, b) => a.startedAt - b.startedAt)
    .flatMap((timing) => [
      timing,
      ...(children.get(timing.id) ?? []).sort(
        (a, b) => a.startedAt - b.startedAt,
      ),
    ]);

  return html`<section class="timings-section">
    <h2>Timings</h2>
    <div
      class="table-wrapper timings-wrapper"
      tabindex="0"
      role="region"
      aria-label="Run timing waterfall"
    >
      <table class="timings-table">
        <caption class="visually-hidden">
          Scrapers and storages share an elapsed-time axis. Indented rows show
          storage steps.
        </caption>
        <colgroup>
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Activity</th>
            <th scope="col">
              <span class="visually-hidden">Elapsed from run start</span>
              <svg class="timing-chart timing-axis" aria-hidden="true">
                ${[0, 1, 2, 3, 4]
                  .map(
                    (tick) =>
                      html`<text
                        x="${String(tick * 25)}%"
                        y="17"
                        text-anchor="${
                          tick === 0 ? "start" : tick === 4 ? "end" : "middle"
                        }"
                      >
                        ${duration((tick * totalMs) / 4)}
                      </text>`,
                  )
                  .join("")}
              </svg>
            </th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((timing) => {
              const elapsed = Math.max(0, timing.startedAt - start);
              const durationMs = Math.max(
                0,
                (timing.endedAt ?? currentEnd) - timing.startedAt,
              );
              const kind =
                timing.kind === "scraper"
                  ? "Scraper"
                  : timing.kind === "storage"
                    ? "Storage"
                    : "Step";
              const state = timing.failed
                ? "Failed"
                : timing.endedAt === undefined
                  ? "Running"
                  : "Completed";
              const label = `${kind} ${timing.name}: ${state}; start ${duration(elapsed)}; duration ${duration(durationMs)}`;
              return html`<tr
                class="${timing.parentId ? "timing-step" : "timing-row"}"
              >
                <th scope="row">
                  ${escaped(timing.name)}
                  <small class="timing-kind"
                    >${kind} &middot;
                    ${duration(durationMs)}${
                      state === "Completed" ? "" : ` &middot; ${state}`
                    }</small
                  >
                </th>
                <td>
                  <svg
                    class="timing-chart timing-${escaped(timing.kind)}${
                      timing.failed ? " timing-failed" : ""
                    }${timing.endedAt === undefined ? " timing-running" : ""}"
                    viewBox="0 0 1000 24"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label="${escaped(label)}"
                  >
                    <title>${escaped(label)}</title>
                    <path
                      class="timing-grid"
                      d="M0 0V24M250 0V24M500 0V24M750 0V24M1000 0V24"
                    />
                    <rect
                      class="timing-bar"
                      x="${((elapsed / scale) * 1000).toFixed(3)}"
                      y="6"
                      width="${((durationMs / scale) * 1000).toFixed(3)}"
                      height="12"
                      rx="3"
                    />
                  </svg>
                </td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  </section>`;
}

export function renderReportAccounts(
  results: Array<AccountScrapeResult>,
  screenshotsHTML = "",
) {
  if (!results.length && !screenshotsHTML) return "";

  const table = results.length
    ? html`<div class="table-wrapper">
        <table class="accounts-table results-table">
          <caption class="visually-hidden">
            Account scrape results
          </caption>
          <colgroup>
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Status</th>
              <th scope="col">Account</th>
              <th scope="col">Transactions</th>
            </tr>
          </thead>
          <tbody>
            ${results
              .map(({ companyId, result }) => {
                if (!result.success) {
                  const failure = `❌ Failed: ${result.errorType ?? "Unknown error"}`;
                  return html`<tr>
                    <td>${escaped(companyId)}</td>
                    <td>
                      ${
                        result.errorMessage
                          ? renderErrorDetails(failure, result.errorMessage)
                          : escaped(failure)
                      }
                    </td>
                    <td>—</td>
                    <td>—</td>
                  </tr>`;
                }

                const accounts = result.accounts ?? [];
                return accounts.length
                  ? accounts
                      .map(
                        (account) =>
                          html`<tr>
                            <td>${escaped(companyId)}</td>
                            <td>✅ Succeeded</td>
                            <td>${escaped(account.accountNumber)}</td>
                            <td>${escaped(account.txns.length)}</td>
                          </tr>`,
                      )
                      .join("")
                  : html`<tr>
                      <td>${escaped(companyId)}</td>
                      <td>✅ Succeeded</td>
                      <td>No accounts returned</td>
                      <td>0</td>
                    </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`
    : "";
  return html`<section class="accounts-section">
    <h2>Accounts</h2>
    ${table}${screenshotsHTML}
  </section>`;
}

export function renderReportStorages(storages: Record<string, StorageRow>) {
  const entries = Object.entries(storages);
  if (!entries.length) return "";

  return html`<section>
    <h2>Storages</h2>
    <div class="table-wrapper">
      <table class="storages-table results-table">
        <caption class="visually-hidden">
          Storage save results
        </caption>
        <colgroup>
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Summary</th>
          </tr>
        </thead>
        <tbody>
          ${entries
            .map(([name, row]) => {
              const summary =
                row.state === "done"
                  ? `${row.stats.total} total · ${row.stats.added} added · ${row.stats.existing} existing · ${row.stats.pending} pending · ${row.stats.otherSkipped} other skipped · ${(row.durationMs / 1000).toFixed(2)}s`
                  : "⏳ Saving";
              return html`<tr class="storage-row">
                  <td>
                    ${escaped(name)}${
                      row.state === "done" && row.stats.table
                        ? html`<small class="storage-table"
                            >${escaped(row.stats.table)}</small
                          >`
                        : ""
                    }
                  </td>
                  <td>
                    ${
                      row.state === "error"
                        ? renderErrorDetails("❌ Failed", row.message)
                        : escaped(summary)
                    }
                  </td>
                </tr>
                ${
                  row.state !== "error" && row.steps.length
                    ? html`<tr class="storage-detail-row">
                        <td colspan="2">
                          <ol class="storage-steps" aria-label="Storage steps">
                            ${row.steps
                              .map(
                                ({ name: stepName, durationMs }) =>
                                  html`<li>
                                    ${escaped(stepName)}${
                                      durationMs === undefined
                                        ? ""
                                        : ` (${(durationMs / 1000).toFixed(2)}s)`
                                    }
                                  </li>`,
                              )
                              .join("")}
                          </ol>
                        </td>
                      </tr>`
                    : ""
                }`.trimEnd();
            })
            .join("")}
        </tbody>
      </table>
    </div>
  </section>`;
}

export function renderReportTransactions(results: Array<AccountScrapeResult>) {
  const transactions = results.flatMap(({ companyId, result }) =>
    result.success
      ? (result.accounts ?? []).flatMap((account) =>
          account.txns.map((transaction) => ({
            ...transaction,
            companyId,
            accountNumber: account.accountNumber,
          })),
        )
      : [],
  );
  if (!transactions.length) return "";
  // Template contents aren't traversed by hydration; keep downloads outside it.
  return html`<template id="transactions-json">
      ${escaped(JSON.stringify(transactions, null, 2))}
    </template>
    ${collectResultSync(
      render(
        litHtml`<report-transactions id="transactions-ui" data-ssr .transactions=${transactions}>${renderLight()}</report-transactions>`,
        { elementRenderers: [ReportLightRenderer] },
      ),
    ).replaceAll("\r", "&#13;")}`;
}

export function renderReportErrors(
  errors: Array<{ caller: string; message: string }>,
) {
  if (!errors.length) return "";

  return html`<section>
    <h2>Errors</h2>
    <div class="report-grid">
      ${errors
        .map(({ caller, message }) => renderErrorDetails(caller, message))
        .join("")}
    </div>
  </section>`;
}

function screenshotSize(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !/^data:image\//i.test(dataUrl)) return undefined;
  const payload = dataUrl.slice(comma + 1);
  if (/%(?![a-f\d]{2})/i.test(payload)) return undefined;
  let bytes: number;
  if (/;base64$/i.test(dataUrl.slice(0, comma))) {
    const base64 = payload
      .replace(/%[a-f\d]{2}/gi, (escape) =>
        String.fromCharCode(Number.parseInt(escape.slice(1), 16)),
      )
      .replace(/[\t\n\f\r ]/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return undefined;
    const padding = base64.length - base64.replace(/=+$/, "").length;
    const length = base64.length - padding;
    if (
      length % 4 === 1 ||
      (padding > 0 && (base64.length % 4 !== 0 || length % 4 !== 4 - padding))
    )
      return undefined;
    bytes = Math.floor((length * 3) / 4);
  } else {
    // Each percent escape is one original byte; literal Unicode is UTF-8.
    bytes = Buffer.byteLength(payload.replace(/%[a-f\d]{2}/gi, "x"), "utf8");
  }
  return bytes > 0 && bytes < 10_000
    ? "<0.01 MB"
    : `${(bytes / 1_000_000).toFixed(2)} MB`;
}

export function renderReportScreenshots(
  screenshots: Array<{ caption: string; dataUrl: string }>,
) {
  const usableScreenshots = screenshots.filter(({ dataUrl }) => dataUrl.trim());
  if (!usableScreenshots.length) return "";

  return html`<div class="account-screenshots">
    <details class="screenshots-details">
      <summary>Screenshots (${escaped(usableScreenshots.length)})</summary>
      <div class="screenshots">
        ${usableScreenshots
          .map(({ caption, dataUrl }) => {
            const size = screenshotSize(dataUrl) ?? "Size unavailable";
            return html`<figure class="screenshot">
              <button
                type="button"
                class="screenshot-open"
                aria-label="${escaped(`Enlarge screenshot: ${caption}`)}"
                data-size="${escaped(size)}"
              >
                <img src="${escaped(dataUrl)}" alt="${escaped(caption)}" />
              </button>
              <figcaption>
                ${escaped(caption)}
                <small class="screenshot-size">${escaped(size)}</small>
              </figcaption>
            </figure>`;
          })
          .join("")}
      </div>
    </details>
    <dialog
      id="screenshot-dialog"
      class="screenshot-dialog"
      aria-labelledby="screenshot-full-caption"
      closedby="any"
    >
      <button
        type="button"
        class="screenshot-close"
        commandfor="screenshot-dialog"
        command="close"
        aria-label="Close screenshot"
        title="Close screenshot"
        autofocus
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m6 6 12 12M6 18 18 6" />
        </svg>
      </button>
      <figure>
        <img id="screenshot-full" alt="" />
        <figcaption>
          <span id="screenshot-full-caption"></span>
          <small id="screenshot-full-size" class="screenshot-size"></small>
        </figcaption>
      </figure>
    </dialog>
  </div>`;
}

export function renderReportLogs(logs: string) {
  // Character references preserve CR through HTML parsing, unlike literal CR.
  return html`<template id="logs-json" data-json
      >${escaped(JSON.stringify(logs))}</template
    >
    ${collectResultSync(
      render(
        litHtml`<report-logs id="logs-ui" data-ssr .logs=${logs}>${renderLight()}</report-logs>`,
        { elementRenderers: [ReportLightRenderer] },
      ),
    ).replaceAll("\r", "&#13;")}`;
}
