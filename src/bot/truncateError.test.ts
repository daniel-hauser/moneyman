import { truncateError } from "./truncateError.js";

describe("truncateError", () => {
  it("keeps only the first line before the stack trace", () => {
    const message = `fetchGetWithinPage parse error: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
    at JSON.parse (<anonymous>)
    at fetchGetWithinPage (file:///app/node_modules/x.js:1:1)`;
    expect(truncateError(message)).toBe(
      `fetchGetWithinPage parse error: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
    );
  });

  it("drops repeated lines", () => {
    expect(truncateError("a\na\nb")).toBe("a\nb");
  });

  it("caps the number of lines", () => {
    expect(truncateError("1\n2\n3\n4\n5")).toBe("1\n2\n3…");
  });

  it("caps the number of chars and ends with an ellipsis", () => {
    const result = truncateError("x".repeat(1000));
    expect(result).toHaveLength(300);
    expect(result.endsWith("…")).toBe(true);
  });

  it("leaves short messages untouched", () => {
    expect(truncateError("short")).toBe("short");
  });
});
