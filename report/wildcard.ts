type Token =
  { type: "star" } | { type: "any" } | { type: "literal"; value: string };

export type Span = [start: number, end: number];

export function compilePattern(term: string): Token[] {
  const characters = Array.from(term);
  const tokens: Token[] = [];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (character === "~" && ["*", "?", "~"].includes(characters[index + 1])) {
      tokens.push({
        type: "literal",
        value: characters[++index].toLowerCase(),
      });
    } else if (character === "*") {
      if (tokens.at(-1)?.type !== "star") tokens.push({ type: "star" });
    } else if (character === "?") {
      tokens.push({ type: "any" });
    } else {
      tokens.push({ type: "literal", value: character.toLowerCase() });
    }
  }
  return tokens;
}

export function matchPattern(text: string, tokens: Token[]) {
  const characters = Array.from(text);
  const offsets = [0];
  for (const character of characters) {
    offsets.push(offsets[offsets.length - 1] + character.length);
  }
  const folded = characters.map((character) => character.toLowerCase());
  let ends = Int32Array.from(offsets, (_, index) => index);
  // Suffix dynamic programming bounds work to O(text length × pattern length).
  for (const token of tokens.slice().reverse()) {
    const next = new Int32Array(characters.length + 1).fill(-1);
    if (token.type === "star")
      next[characters.length] = ends[characters.length];
    for (let index = characters.length - 1; index >= 0; index--) {
      if (token.type === "star") {
        next[index] = Math.max(ends[index], next[index + 1]);
      } else if (token.type === "any" || token.value === folded[index]) {
        next[index] = ends[index + 1];
      }
    }
    ends = next;
  }
  const spans: Span[] = [];
  let matched = false;
  for (let index = 0; index < ends.length;) {
    const end = ends[index];
    if (end >= index) matched = true;
    if (end > index) {
      spans.push([offsets[index], offsets[end]]);
      index = end;
    } else {
      index++;
    }
  }
  return { matched, spans };
}
