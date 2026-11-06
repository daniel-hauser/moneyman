import { html, noChange } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { ReportLightElement } from "./light-element.js";
import {
  effectiveAttributes,
  elapsedMs,
  operationLabel,
  queryDiagnostics,
  spanAncestors,
  timestamp,
  type DiagnosticQuery,
  type DiagnosticSpan,
  type Diagnostics,
} from "./diagnostics.js";

const facets = [
  ["account.company", "Company"],
  ["account.index", "Configured account index"],
  ["storage.name", "Storage"],
  ["log.namespace", "Namespace"],
] as const;

export class ReportDiagnostics extends ReportLightElement {
  static properties = {
    diagnostics: { attribute: false },
    query: { state: true },
  };

  declare diagnostics: Diagnostics;
  declare query: DiagnosticQuery;

  constructor() {
    super();
    this.diagnostics = {
      spans: [],
      events: [],
      warnings: [],
      origin: "0",
      droppedEvents: 0,
    };
    this.query = { descendants: true };
  }

  protected readPayload() {
    const payload =
      this.ownerDocument.querySelector<HTMLTemplateElement>(
        "#diagnostics-json",
      );
    if (!payload) throw new Error("Missing diagnostics payload");
    this.diagnostics = JSON.parse(payload.content.textContent ?? "{}");
  }

  private select(
    label: string,
    id: string,
    values: Array<{ value: string; label: string }>,
    selected: string,
    change: (value: string) => void,
  ) {
    return html`<label
      >${label}
      <select
        id=${id}
        class="interactive"
        @change=${(event: Event) => change((event.currentTarget as HTMLSelectElement).value)}
      >
        <option
          value=""
          ?selected=${!selected}
          .selected=${this.hydrating ? noChange : !selected}
        >
          All
        </option>
        ${values.map(({ value, label: name }) => html`<option value=${value} ?selected=${value === selected} .selected=${this.hydrating ? noChange : value === selected}>${this.displayText(name)}</option>`)}
      </select>
    </label>`;
  }

  private download(
    label: string,
    target: string,
    filename: string,
    type: string,
  ) {
    return html`<button
      type="button"
      class="interactive"
      data-download=${target}
      data-filename=${filename}
      data-type=${type}
    >
      ${label}
    </button>`;
  }

  render() {
    const data = this.diagnostics;
    const query = this.query;
    const spans = new Map(data.spans.map((span) => [span.key, span]));
    const events = queryDiagnostics(data, { ...query, term: this.term });
    const traces = [
      ...new Set([
        ...data.spans.map((span) => span.traceId),
        ...data.events.map((event) => event.traceId),
      ]),
    ]
      .filter(Boolean)
      .sort();
    const operations = data.spans
      .filter((span) => !query.traceId || span.traceId === query.traceId)
      .sort((a, b) => elapsedMs(a.start, b.start));
    const children = new Map<string | undefined, DiagnosticSpan[]>();
    for (const span of operations) {
      const parent =
        span.parentKey && spans.has(span.parentKey)
          ? span.parentKey
          : undefined;
      const siblings = children.get(parent) ?? [];
      siblings.push(span);
      children.set(parent, siblings);
    }
    const ordered: DiagnosticSpan[] = [];
    const seen = new Set<string>();
    const visit = (span: DiagnosticSpan) => {
      if (seen.has(span.key)) return;
      seen.add(span.key);
      ordered.push(span);
      for (const child of children.get(span.key) ?? []) visit(child);
    };
    for (const span of children.get(undefined) ?? []) visit(span);
    for (const span of operations) visit(span);
    const allAttrs = data.events.map((event) =>
      effectiveAttributes(event, spans),
    );
    const selected = spanAncestors(query.operation, spans);
    const end = data.events.reduce(
      (latest, event) => Math.max(latest, elapsedMs(event.time, data.origin)),
      1,
    );
    return html`<section aria-labelledby="diagnostics-heading">
      <div class="section-heading">
        <h2 id="diagnostics-heading">
          Diagnostics
          <span id="diagnostics-count" aria-live="polite"
            >(${events.length} of ${data.events.length} events)</span
          >
        </h2>
        <div class="heading-actions">
          ${this.download("Download diagnostics JSON", "diagnostics-json", "diagnostics.json", "application/json;charset=utf-8")}
          ${this.download("Download original OTLP", "telemetry-json", "telemetry.otel.jsonl", "application/x-ndjson;charset=utf-8")}
        </div>
      </div>
      ${data.droppedEvents ? html`<p class="javascript-warning" role="status">${data.droppedEvents} span events were dropped by the recorder. This history is incomplete.</p>` : ""}
      ${
        data.warnings.length
          ? html`<details class="diagnostics-warning">
              <summary>
                ${data.warnings.length} parsing warnings — some records could
                not be displayed
              </summary>
              <ul>
                ${data.warnings.map((warning) => html`<li>${warning}</li>`)}
              </ul>
              <p>
                The original OTLP download preserves every input line, including
                malformed entries.
              </p>
            </details>`
          : ""
      }
      <div class="diagnostics-filters interactive">
        <label
          >Search whole events
          <input
            id="search-diagnostics"
            type="search"
            aria-controls="diagnostic-events"
            placeholder="Filter: * any text, ? one character"
            title="Case-insensitive; * and ? cross line endings. ~ escapes wildcards."
            @input=${this.onInput}
          />
        </label>
        ${this.select(
          "Trace / run",
          "diagnostic-trace",
          traces.map((traceId) => {
            const run = data.spans.find(
              (span) => span.traceId === traceId && span.attributes["run.id"],
            );
            return {
              value: traceId,
              label: `${run?.attributes["run.id"] ?? traceId}${run?.attributes["run.trigger"] ? ` · ${run.attributes["run.trigger"]}` : ""}`,
            };
          }),
          query.traceId ?? "",
          (traceId) => {
            this.query = { ...query, traceId, operation: undefined };
          },
        )}
        ${this.select(
          "Operation",
          "diagnostic-operation",
          ordered.map((span) => ({
            value: span.key,
            label: `${"— ".repeat(Math.max(0, spanAncestors(span.key, spans).length - 1))}${operationLabel(span)}`,
          })),
          query.operation ?? "",
          (operation) => {
            this.query = { ...query, operation };
          },
        )}
        <label
          ><input
            id="diagnostic-descendants"
            type="checkbox"
            ?checked=${query.descendants !== false}
            @change=${(event: Event) => {
              this.query = {
                ...query,
                descendants: (event.currentTarget as HTMLInputElement).checked,
              };
            }}
          />
          Include descendant operations</label
        >
        ${facets.map(([name, label]) =>
          this.select(
            label,
            `facet-${name.replace(".", "-")}`,
            [
              ...new Set(
                allAttrs
                  .map((attrs) => attrs[name])
                  .filter((value) => value !== undefined),
              ),
            ]
              .sort()
              .map((value) => ({ value, label: value })),
            query.facets?.[name] ?? "",
            (value) => {
              this.query = {
                ...query,
                facets: { ...query.facets, [name]: value },
              };
            },
          ),
        )}
        ${this.select(
          "Record type",
          "diagnostic-type",
          ["log", "milestone", "exception", "failure"].map((value) => ({
            value,
            label: value === "failure" ? "Failures and exceptions" : value,
          })),
          query.type ?? "",
          (type) => {
            this.query = { ...query, type };
          },
        )}
        <button
          id="diagnostics-reset"
          type="button"
          @click=${() => {
            this.query = { descendants: true };
            this.term = "";
            const search = this.querySelector<HTMLInputElement>(
              "#search-diagnostics",
            );
            if (search) search.value = "";
          }}
        >
          Reset filters
        </button>
      </div>
      <p class="diagnostic-context">
        Operation context:
        ${selected.length ? selected.map(operationLabel).join(" → ") : "All operations"}.
        Unscoped records are never assigned a guessed owner.
      </p>
      <details class="diagnostic-operations">
        <summary>
          Operation hierarchy and timings (${operations.length})
        </summary>
        <p>
          These are the recorded spans. Select an operation to explore its
          timeline; ancestors and siblings remain visible.
        </p>
        <ul aria-label="Operation hierarchy">
          ${ordered.map(
            (span) =>
              html`<li>
                <button
                  type="button"
                  class="interactive"
                  aria-pressed=${query.operation === span.key}
                  @click=${() => {
                    this.query = { ...query, operation: span.key };
                  }}
                >
                  ${"— ".repeat(Math.max(0, spanAncestors(span.key, spans).length - 1))}${this.displayText(operationLabel(span))}
                </button>
                <span class="diagnostic-operation-name"
                  >${this.displayText(operationLabel(span))}</span
                >
                <svg
                  class="diagnostic-waterfall"
                  viewBox="0 0 1000 12"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label=${`${operationLabel(span)} recorded interval`}
                >
                  <rect
                    x=${Math.max(0, (elapsedMs(span.start, data.origin) / end) * 1000)}
                    y="1"
                    width=${span.end ? Math.max(1, (elapsedMs(span.end, span.start) / end) * 1000) : 1}
                    height="10"
                  ></rect>
                </svg>
                <small
                  >+${(elapsedMs(span.start, data.origin) / 1000).toFixed(3)}s ·
                  ${span.end ? `${(elapsedMs(span.end, span.start) / 1000).toFixed(3)}s` : "duration unknown"}
                  ·
                  ${this.displayText(span.status)}${span.parentKey && !spans.has(span.parentKey) ? " · parent not recorded" : ""}</small
                >
              </li>`,
          )}
        </ul>
      </details>
      <ol
        id="diagnostic-events"
        class="diagnostic-events"
        aria-label="Chronological diagnostic events"
      >
        ${repeat(
          events,
          (event) => event.id,
          (event) => {
            const owner = event.ownerKey
              ? spans.get(event.ownerKey)
              : undefined;
            const attrs = effectiveAttributes(event, spans);
            const context = spanAncestors(event.ownerKey, spans)
              .map(operationLabel)
              .join(" → ");
            return html`<li data-event-id=${event.id}>
              <details>
                <summary>
                  <time
                    datetime=${event.time === "0" ? "" : timestamp(event.time)}
                    >${timestamp(event.time)}</time
                  >
                  <small
                    >${event.time === "0" ? "" : `+${(elapsedMs(event.time, data.origin) / 1000).toFixed(3)}s`}
                    · ${event.type}</small
                  >
                  <span class="diagnostic-owner"
                    >${owner ? this.displayText(operationLabel(owner)) : event.ownerKey ? "Orphan — operation not recorded" : "Unscoped"}${attrs["log.namespace"] ? ` · ${this.displayText(attrs["log.namespace"])}` : ""}</span
                  >
                  <span class="diagnostic-preview"
                    >${this.displayText(event.body.split(/\r?\n/)[0] || event.name)}</span
                  >
                </summary>
                <p>
                  ${this.displayText(context || "No recorded operation context")}
                  · trace
                  ${event.traceId || "unscoped"}${event.ownerKey ? ` · ${event.ownerKey}` : ""}
                </p>
                <pre class="diagnostic-body">
${this.displayText(event.body)}</pre>
                <dl class="diagnostic-attributes">
                  ${Object.entries(attrs).map(
                    ([name, value]) =>
                      html`<div>
                        <dt>${this.displayText(name)}</dt>
                        <dd>${this.displayText(value)}</dd>
                      </div>`,
                  )}
                </dl>
              </details>
            </li>`;
          },
        )}
      </ol>
      ${!events.length ? html`<p>No events match these filters.</p>` : ""}
    </section>`;
  }
}

customElements.define("report-diagnostics", ReportDiagnostics);
