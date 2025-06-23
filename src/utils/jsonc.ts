import * as jsonc from "jsonc-parser";

/**
 * Parse JSONC (JSON with Comments) string into a JavaScript object
 * @param jsoncString - The JSONC string to parse
 * @returns Parsed JavaScript object
 * @throws Error if parsing fails
 */
export function parseJsonc(jsoncString: string): unknown {
  const errors: jsonc.ParseError[] = [];
  const result = jsonc.parse(jsoncString, errors, {
    allowTrailingComma: true,
    disallowComments: false,
    allowEmptyContent: false,
  });
  if (errors.length > 0) {
    const errorMessages = errors.map((error) => {
      const { error: errorCode, offset, length } = error;
      const errorType = jsonc.printParseErrorCode(errorCode);
      const location = `at position ${offset}${length ? `-${offset + length}` : ""}`;
      return `${errorType} ${location}`;
    });
    throw new Error(`JSONC parsing failed: ${errorMessages.join(", ")}`);
  }

  return result;
}

/**
 * Parse a JSONC string that should represent a config object
 * @param jsoncString - The JSONC string to parse
 * @returns Parsed config object
 * @throws Error if parsing fails or result is not an object
 */
export function parseJsoncConfig(jsoncString: string): Record<string, unknown> {
  const result = parseJsonc(jsoncString);

  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error("JSONC config must be an object");
  }

  return result as Record<string, unknown>;
}
