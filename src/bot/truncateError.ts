const STACK_FRAME = /^\s+at\s/;
const ERROR_HEADER = /^[\w$.]*(Error|Exception)\b.*:/;

export interface TruncateErrorOptions {
  maxChars?: number;
  maxLines?: number;
}

/**
 * Shorten an error message so it fits in a status message.
 * Cuts at the first stack frame, drops repeated lines and caps the length.
 * Operates on raw text - escape the result afterwards, never before.
 */
export function truncateError(
  message: string,
  { maxChars = 300, maxLines = 3 }: TruncateErrorOptions = {},
): string {
  let lines = message.split("\n");
  const firstFrame = lines.findIndex((l) => STACK_FRAME.test(l));
  if (firstFrame !== -1) {
    lines = lines.slice(0, firstFrame);
    // The line right above the frames is the stack's own header, which repeats the message
    if (lines.length > 1 && ERROR_HEADER.test(lines.at(-1)!)) {
      lines.pop();
    }
  }

  const seen = new Set<string>();
  lines = lines
    .map((l) => l.trimEnd())
    .filter((l) => {
      const key = l.trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  let truncated = false;
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    truncated = true;
  }

  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = text.slice(0, maxChars - 1).trimEnd();
    truncated = true;
  }

  return truncated ? `${text}…` : text;
}
