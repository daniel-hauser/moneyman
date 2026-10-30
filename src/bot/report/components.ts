import { escapers } from "@telegraf/entity";
import {
  TransactionStatuses,
  TransactionTypes,
} from "israeli-bank-scrapers/lib/transactions.js";
import type { AccountScrapeResult } from "../../types.js";
import { normalizeCurrency } from "../../utils/currency.js";
import type { StorageRow } from "../runReport.js";
import { html } from "./html.js";

const escaped = (value: string | number) => escapers.HTML(String(value));

function renderErrorDetails(summary: string, message: string) {
  const escapedMessage = escaped(message);
  return html`<details>
    <summary>${escaped(summary)}</summary>
    <pre class="error-message">${escapedMessage}</pre>
  </details>`;
}

export function renderReportRunDetails({
  startedAt,
  failed,
  status,
  totalTimeSec,
}: {
  startedAt: Date;
  failed: boolean;
  status: Array<string>;
  totalTimeSec?: number;
}) {
  return html`<section>
    <h2>Run details</h2>
    <dl class="run-details">
      <div>
        <dt>Final status</dt>
        <dd class="status ${failed ? "failed" : "succeeded"}">
          ${failed ? "❌ Failed" : "✅ Succeeded"}
        </dd>
      </div>
      <div>
        <dt>Started</dt>
        <dd>
          <time datetime="${startedAt.toISOString()}"
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
    </dl>
    <h3>Scraper status</h3>
    <ul class="scraper-status">
      ${status.map((line) => html`<li>${escaped(line)}</li>`).join("")}
    </ul>
  </section>`;
}

export function renderReportAccounts(results: Array<AccountScrapeResult>) {
  if (!results.length) return "";

  return html`<section>
    <h2>Accounts</h2>
    <div class="report-grid">
      ${results
        .map(({ companyId, result }) => {
          if (!result.success) {
            return html`<article class="account-result">
              <h3>❌ ${escaped(companyId)}</h3>
              <p>${escaped(result.errorType ?? "Unknown error")}</p>
              ${
                result.errorMessage
                  ? renderErrorDetails("Error details", result.errorMessage)
                  : ""
              }
            </article>`;
          }

          const accounts = result.accounts ?? [];
          return html`<article class="account-result">
            <h3>✅ ${escaped(companyId)}</h3>
            ${
              accounts.length
                ? html`<ul>
                    ${accounts
                      .map(
                        (account) =>
                          html`<li>
                            Account ${escaped(account.accountNumber)}:
                            ${escaped(account.txns.length)} transactions
                          </li>`,
                      )
                      .join("")}
                  </ul>`
                : html`<p>No accounts returned</p>`
            }
          </article>`;
        })
        .join("")}
    </div>
  </section>`;
}

export function renderReportStorages(storages: Record<string, StorageRow>) {
  const entries = Object.entries(storages);
  if (!entries.length) return "";

  return html`<section>
    <h2>Storages</h2>
    <div class="report-grid">
      ${entries
        .map(([name, row]) => {
          const state =
            row.state === "done"
              ? "✅ Saved"
              : row.state === "error"
                ? "❌ Failed"
                : "⏳ Saving";
          return html`<article class="storage-result">
            <h3>${escaped(name)}</h3>
            <p class="storage-state">${state}</p>
            ${
              row.state === "error"
                ? renderErrorDetails("Error details", row.message)
                : html`${
                    row.state === "done" && row.stats.table
                      ? html`<p>Table: ${escaped(row.stats.table)}</p>`
                      : ""
                  }
                  ${
                    row.steps.length
                      ? html`<h4>Steps</h4>
                          <ul>
                            ${row.steps
                              .map(
                                ({ name: stepName, durationMs }) =>
                                  html`<li>
                                    ${escaped(stepName)}
                                    ${
                                      durationMs === undefined
                                        ? ""
                                        : ` — ${(durationMs / 1000).toFixed(2)}s`
                                    }
                                  </li>`,
                              )
                              .join("")}
                          </ul>`
                      : ""
                  }
                  ${
                    row.state === "done"
                      ? html`<dl class="storage-stats">
                          <div>
                            <dt>Added</dt>
                            <dd>${escaped(row.stats.added)}</dd>
                          </div>
                          <div>
                            <dt>Existing</dt>
                            <dd>${escaped(row.stats.existing)}</dd>
                          </div>
                          <div>
                            <dt>Pending</dt>
                            <dd>${escaped(row.stats.pending)}</dd>
                          </div>
                          <div>
                            <dt>Other skipped</dt>
                            <dd>${escaped(row.stats.otherSkipped)}</dd>
                          </div>
                          <div>
                            <dt>Total</dt>
                            <dd>${escaped(row.stats.total)}</dd>
                          </div>
                          <div>
                            <dt>Save time</dt>
                            <dd>
                              ${(row.durationMs / 1000).toFixed(2)} seconds
                            </dd>
                          </div>
                        </dl>`
                      : ""
                  }`
            }
          </article>`;
        })
        .join("")}
    </div>
  </section>`;
}

export function renderReportTransactions(results: Array<AccountScrapeResult>) {
  const transactions = results.flatMap(({ companyId, result }) =>
    result.success
      ? (result.accounts ?? []).flatMap((account) =>
          account.txns.map((transaction) => ({
            companyId,
            accountNumber: account.accountNumber,
            transaction,
          })),
        )
      : [],
  );
  if (!transactions.length) return "";

  return html`<section>
    <h2>Transactions</h2>
    <details>
      <summary>${escaped(transactions.length)} transactions</summary>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Company</th>
              <th>Account</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${transactions
              .map(({ companyId, accountNumber, transaction }) => {
                const pendingOriginal =
                  transaction.type === TransactionTypes.Normal &&
                  transaction.status === TransactionStatuses.Pending;
                const amount = pendingOriginal
                  ? transaction.originalAmount
                  : transaction.chargedAmount;
                const currency =
                  (pendingOriginal
                    ? normalizeCurrency(transaction.originalCurrency)
                    : normalizeCurrency(transaction.chargedCurrency)) ||
                  normalizeCurrency(transaction.originalCurrency);
                return html`<tr>
                  <td>${escaped(transaction.date)}</td>
                  <td>${escaped(companyId)}</td>
                  <td>${escaped(accountNumber)}</td>
                  <td>${escaped(transaction.description)}</td>
                  <td>${amount.toFixed(2)} ${escaped(currency ?? "")}</td>
                  <td>${escaped(transaction.status)}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </details>
  </section>`;
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

export function renderReportScreenshots(
  screenshots: Array<{ caption: string; dataUrl: string }>,
) {
  if (!screenshots.length) return "";

  return html`<section>
    <h2>Screenshots</h2>
    <div class="screenshots">
      ${screenshots
        .map(
          ({ caption, dataUrl }) =>
            html`<figure class="screenshot">
              <a
                href="${escapers.HTML(dataUrl)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src="${escapers.HTML(dataUrl)}"
                  alt="${escapers.HTML(caption)}"
                />
              </a>
              <figcaption>${escapers.HTML(caption)}</figcaption>
            </figure>`,
        )
        .join("")}
    </div>
  </section>`;
}

export function renderReportLogs(logs: string) {
  const escapedLogs = escaped(logs).replaceAll("\r", "&#13;");
  return html`<section>
    <h2>Logs</h2>
    <button id="download-logs" type="button">Download logs as JSON</button>
    <pre id="run-logs" class="run-logs"><code>${escapedLogs}</code></pre>
    <script>
      document.getElementById("download-logs").addEventListener("click", () => {
        const logs = document.getElementById("run-logs").textContent;
        const url = URL.createObjectURL(
          new Blob([JSON.stringify({ logs })], { type: "application/json" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "logs.json";
        document.body.appendChild(link);
        try {
          link.click();
        } finally {
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        }
      });
    </script>
  </section>`;
}
