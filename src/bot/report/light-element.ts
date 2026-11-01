import {
  LitElement,
  type PropertyValues,
  type PropertyDeclarations,
} from "lit";
import { hydrate } from "@lit-labs/ssr-client";
import { compilePattern, matchPattern, type Span } from "./wildcard.js";

export type Highlighter = (name: string, ranges: Range[]) => void;

function setHighlights(name: string, ranges: Range[]) {
  const highlight = new Highlight();
  for (const range of ranges) highlight.add(range);
  CSS.highlights.set(name, highlight);
}

export function rangesFor(document: Document, node: Text, spans: Span[]) {
  return spans.map(([start, end]) => {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  });
}

export function textNode(element: Element) {
  return Array.from(element.childNodes).find(
    (node): node is Text => node.nodeType === 3,
  );
}

export abstract class ReportLightElement extends LitElement {
  static properties: PropertyDeclarations = {
    term: { state: true },
    hydrating: { state: true },
  };

  declare term: string;
  declare protected hydrating: boolean;
  highlight: Highlighter = setHighlights;

  constructor() {
    super();
    this.term = "";
    this.hydrating = true;
  }

  protected createRenderRoot() {
    return this;
  }

  protected update(changed: PropertyValues) {
    if (!this.hasUpdated && this.hasAttribute("data-ssr")) {
      this.readPayload();
      // Public light-DOM hydration installs the root part used by LitElement's
      // normal update, with the exact SSR values before locale/filter changes.
      hydrate(this.render(), this, this.renderOptions);
    }
    super.update(changed);
  }

  renderLight() {
    return this.render();
  }

  protected abstract readPayload(): void;

  protected firstUpdated() {
    // Do not bind .value: browsers may restore this input before upgrade.
    this.term = this.querySelector<HTMLInputElement>("input")?.value ?? "";
    this.hydrating = false;
  }

  protected displayText(value: string) {
    // HTML cannot preserve NUL or unpaired surrogates. Emit predictable parsed
    // SSR text, hydrate that value, then restore the original in normal updates.
    return this.hydrating
      ? value.replace(
          /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]|\0/g,
          (character) => (character.length === 2 ? character : "\uFFFD"),
        )
      : value;
  }

  protected onInput(event: Event) {
    this.term = (event.currentTarget as HTMLInputElement).value;
  }

  protected get tokens() {
    return compilePattern(this.term);
  }

  protected match(value: string, tokens = this.tokens) {
    return this.term
      ? matchPattern(value, tokens)
      : { matched: true, spans: [] as Span[] };
  }

  async ready() {
    while (!(await this.updateComplete)) {
      // firstUpdated can schedule localization/restored-filter updates.
    }
  }
}
