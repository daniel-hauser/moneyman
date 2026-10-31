import { html } from "lit-html";
import type { TransactionView } from "./transactions.js";

function searchControl(
  id: string,
  label: string,
  controls: string,
  onInput?: (event: Event) => void,
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

function downloadButton(
  id: string,
  label: string,
  target: string,
  filename: string,
  type: string,
) {
  return html`<button
    id=${id}
    class="download-button interactive"
    type="button"
    aria-label=${label}
    title=${label}
    data-download=${target}
    data-filename=${filename}
    data-type=${type}
  >
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <use href="#download-icon" />
    </svg>
  </button>`;
}

export type SortKey = "date" | "amount" | "account";
export type Direction = "ascending" | "descending";
export type Sorting = { key: SortKey; direction: Direction };

function sortControl(
  key: SortKey,
  sorting?: Sorting,
  onSort?: (key: SortKey, direction: Direction) => void,
) {
  const direction = sorting?.key === key ? sorting.direction : "none";
  const next = direction === "ascending" ? "descending" : "ascending";
  const title = `Sort ${key} ${next}`;
  return html`<button
    type="button"
    class="sort-button interactive"
    data-sort=${key}
    aria-label=${title}
    title=${title}
    @click=${onSort ? () => onSort(key, next) : undefined}
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

const sortDirection = (key: SortKey, sorting?: Sorting) =>
  sorting?.key === key ? sorting.direction : "none";

export function transactionsTemplate(
  views: TransactionView[],
  total = views.length,
  term = "",
  sorting?: Sorting,
  onInput?: (event: Event) => void,
  onSort?: (key: SortKey, direction: Direction) => void,
) {
  return html`<section>
    <div class="section-heading">
      <h2>
        Transactions
        <span id="transaction-count" aria-live="polite"
          >${term ? `(${views.length} of ${total})` : `(${total})`}</span
        >
      </h2>
      <div class="heading-actions">
        ${searchControl("search-transactions", "Filter transactions", "transaction-rows", onInput)}
        ${downloadButton("download-transactions", "Download transactions as JSON", "transactions-json", "transactions.json", "application/json;charset=utf-8")}
      </div>
    </div>
    <div
      class="table-wrapper transactions-wrapper"
      tabindex="0"
      role="region"
      aria-label="Transactions"
    >
      <table class="transactions-table">
        <caption class="visually-hidden">
          Scraped transactions
        </caption>
        <thead>
          <tr>
            <th scope="col" aria-sort=${sortDirection("date", sorting)}>
              Date ${sortControl("date", sorting, onSort)}
            </th>
            <th scope="col" aria-sort=${sortDirection("amount", sorting)}>
              Amount ${sortControl("amount", sorting, onSort)}
            </th>
            <th scope="col">Description</th>
            <th scope="col" aria-sort=${sortDirection("account", sorting)}>
              Account ${sortControl("account", sorting, onSort)}
            </th>
            <th scope="col">Company</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody id="transaction-rows">
          ${views.map(
            (view) =>
              html`<tr>
                ${view.cells.map((value, column) => {
                  const content =
                    column === 0
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
          )}
        </tbody>
      </table>
    </div>
  </section>`;
}

export function logsTemplate(logs: string, onInput?: (event: Event) => void) {
  return html`<section>
    <div class="logs-heading section-heading">
      <h2>Logs</h2>
      <div class="heading-actions">
        ${searchControl("search-logs", "Filter logs", "run-logs", onInput)}
        ${downloadButton("download-logs", "Download logs", "logs-json", "logs.txt", "text/plain;charset=utf-8")}
      </div>
    </div>
    <pre id="run-logs" class="run-logs"><code>${logs}</code></pre>
  </section>`;
}
