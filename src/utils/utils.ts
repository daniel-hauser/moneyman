/// <reference lib="esnext.disposable" />
import { createHash } from "node:crypto";
import { inspect } from "node:util";

export function sha256(
  value: string,
  encoding: "base64" | "base64url" | "hex",
): string {
  return createHash("sha256").update(value, "utf8").digest(encoding);
}

function inspectUnknownObject(value: object): string {
  return inspect(value, {
    depth: 8,
    maxArrayLength: 100,
    breakLength: 100,
    colors: false,
  });
}

export function formatUnknownError(value: unknown): string {
  if (value instanceof SuppressedError) {
    return `${formatUnknownError(value.suppressed)}; cleanup failed: ${formatUnknownError(value.error)}`;
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return inspectUnknownObject(value);
  }
  return String(value);
}
