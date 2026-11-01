import { LitElementRenderer } from "@lit-labs/ssr";
import { ReportLightElement } from "./light-element.js";

// renderLight() is the public SSR light-DOM hook. Omit the default shadow
// template since these components deliberately render into their host.
export class ReportLightRenderer extends LitElementRenderer {
  static matchesClass(ctor: typeof HTMLElement) {
    return ctor.prototype instanceof ReportLightElement;
  }

  renderShadow() {
    return undefined;
  }
}
