import { inspect } from "node:util";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
