import { createHash } from "node:crypto";

export const html = (strings: TemplateStringsArray, ...values: string[]) =>
  String.raw({ raw: strings }, ...values);

export function hashInlineContent(content: string): string {
  // HTML parsing normalizes literal CRLF and CR before CSP checks inline text.
  const normalized = content.replace(/\r\n?/g, "\n");
  return `'sha256-${createHash("sha256").update(normalized).digest("base64")}'`;
}
