import { html } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { ReportLightElement, rangesFor, textNode } from "./light-element.js";
import { transactionView, type ReportTransaction } from "./transactions.js";
import { sortTransactions, type Sorting, type SortKey } from "./sorting.js";
import type { Span } from "./wildcard.js";

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

function sortControl(
  key: SortKey,
  sorting?: Sorting,
  onSort?: (key: SortKey) => void,
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
    @click=${onSort ? () => onSort(key) : undefined}
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

export class ReportTransactions extends ReportLightElement {
  static properties = {
    transactions: { attribute: false },
    sorting: { state: true },
    locale: { state: true },
  };

  declare transactions: ReportTransaction[];
  declare sorting: Sorting | undefined;
  declare locale: string | undefined;

  constructor() {
    super();
    this.transactions = [];
    this.locale = "en-GB";
  }

  protected readPayload() {
    const payload =
      this.ownerDocument.querySelector<HTMLTemplateElement>(
        "#transactions-json",
      );
    if (!payload) throw new Error("Missing transactions payload");
    this.transactions = JSON.parse(payload.content.textContent ?? "[]");
  }

  protected firstUpdated() {
    super.firstUpdated();
    this.locale = undefined;
  }

  private get views() {
    const formatter = new Intl.DateTimeFormat(this.locale, {
      dateStyle: "short",
      timeZone: "UTC",
    });
    return this.transactions.map((transaction, index) => {
      const view = transactionView(transaction, index, formatter);
      return this.hydrating
        ? { ...view, cells: view.cells.map((value) => this.displayText(value)) }
        : view;
    });
  }

  private get matchedViews() {
    const tokens = this.tokens;
    return this.views
      .map((view) => ({
        view,
        match: this.match(view.cells.join(" "), tokens),
      }))
      .filter(({ match }) => match.matched);
  }

  private get selection() {
    const matches = this.matchedViews;
    const views = matches.map(({ view }) => view);
    return {
      matches,
      ordered: this.sorting
        ? sortTransactions(views, this.sorting.key, this.sorting.direction)
        : views,
    };
  }

  private onSort(key: SortKey) {
    this.sorting = {
      key,
      direction:
        this.sorting?.key === key && this.sorting.direction === "ascending"
          ? "descending"
          : "ascending",
    };
  }

  protected updated() {
    if (this.isUpdatePending) return;
    const body =
      this.querySelector<HTMLTableSectionElement>("#transaction-rows")!;
    const selection = this.selection;
    const matches = new Map(
      selection.matches.map(({ view, match }) => [view.index, match.spans]),
    );
    const ranges: Range[] = [];
    for (const [rowIndex, view] of selection.ordered.entries()) {
      const row = body.rows[rowIndex];
      let offset = 0;
      for (const [index, value] of view.cells.entries()) {
        const cell = row.cells[index];
        const node = textNode(cell.querySelector("time") ?? cell);
        const spans = (matches.get(view.index) ?? [])
          .map(([start, end]): Span => [
            Math.max(0, start - offset),
            Math.min(value.length, end - offset),
          ])
          .filter(([start, end]) => end > start);
        if (node) ranges.push(...rangesFor(this.ownerDocument, node, spans));
        offset += value.length + 1;
      }
    }
    this.highlight("transactions-search", ranges);
  }

  render() {
    const views = this.selection.ordered;
    const total = this.transactions.length;
    const term = this.term;
    const sorting = this.sorting;
    const onSort = (key: SortKey) => this.onSort(key);
    return html`<section>
      <div class="section-heading">
        <h2>
          Transactions
          <span id="transaction-count" aria-live="polite"
            >${term ? `(${views.length} of ${total})` : `(${total})`}</span
          >
        </h2>
        <div class="heading-actions">
          ${searchControl("search-transactions", "Filter transactions", "transaction-rows", this.onInput)}
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
            ${repeat(
              views,
              (view) => view.index,
              (view) =>
                html`<tr>
                  ${view.cells.map((value, column) => {
                    const content =
                      column === 0
                        ? html`<time
                            class="transaction-date"
                            datetime=${this.displayText(String(view.transaction.date))}
                            title=${this.displayText(String(view.transaction.date))}
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
}

export class ReportLogs extends ReportLightElement {
  static properties = { logs: { attribute: false } };

  declare logs: string;

  constructor() {
    super();
    this.logs = "";
  }

  protected readPayload() {
    const payload =
      this.ownerDocument.querySelector<HTMLTemplateElement>("#logs-json");
    if (!payload) throw new Error("Missing logs payload");
    this.logs = JSON.parse(payload.content.textContent ?? '""');
  }

  private get filtered() {
    if (!this.term) return { text: this.logs, spans: [] as Span[] };
    const lines = this.logs.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
    const parts: string[] = [];
    const spans: Span[] = [];
    const tokens = this.tokens;
    let length = 0;
    for (const line of lines) {
      const match = this.match(line.replace(/[\r\n]+$/, ""), tokens);
      if (!match.matched) continue;
      parts.push(line);
      for (const [start, end] of match.spans)
        spans.push([length + start, length + end]);
      length += line.length;
    }
    return { text: parts.join(""), spans };
  }

  protected updated() {
    if (this.isUpdatePending) return;
    const node = textNode(this.querySelector("#run-logs code")!);
    this.highlight(
      "log-search",
      node ? rangesFor(this.ownerDocument, node, this.filtered.spans) : [],
    );
  }

  render() {
    return html`<section>
      <div class="logs-heading section-heading">
        <h2>Logs</h2>
        <div class="heading-actions">
          ${searchControl("search-logs", "Filter logs", "run-logs", this.onInput)}
          ${downloadButton("download-logs", "Download logs", "logs-json", "logs.txt", "text/plain;charset=utf-8")}
        </div>
      </div>
      <pre
        id="run-logs"
        class="run-logs"
      ><code>${this.displayText(this.filtered.text)}</code></pre>
    </section>`;
  }
}

customElements.define("report-transactions", ReportTransactions);
customElements.define("report-logs", ReportLogs);
