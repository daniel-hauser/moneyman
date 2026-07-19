import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import z from "zod/v4";
import { loadConfig, readSecretFile } from "./config.js";

const inlineVariable = "MONEYMAN_TEST_CONFIG";
const pathVariable = "MONEYMAN_TEST_CONFIG_PATH";
const secretVariable = "MONEYMAN_TEST_SECRET_PATH";
const schema = z.object({ value: z.string().min(1) });

describe("configuration loading", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "moneyman-config-"));
    delete process.env[inlineVariable];
    delete process.env[pathVariable];
    delete process.env[secretVariable];
  });

  afterEach(() => {
    delete process.env[inlineVariable];
    delete process.env[pathVariable];
    delete process.env[secretVariable];
    rmSync(directory, { recursive: true, force: true });
  });

  it("prefers inline JSONC configuration", () => {
    const path = join(directory, "config.jsonc");
    writeFileSync(path, '{"value":"file"}');
    process.env[inlineVariable] = '{/* comment */"value":"inline"}';
    process.env[pathVariable] = path;

    expect(
      loadConfig(schema, {
        inlineEnvironmentVariable: inlineVariable,
        pathEnvironmentVariable: pathVariable,
      }),
    ).toEqual({ value: "inline" });
  });

  it("loads JSONC configuration from a file", () => {
    const path = join(directory, "config.jsonc");
    writeFileSync(path, '{/* comment */"value":"file"}');
    process.env[pathVariable] = path;

    expect(
      loadConfig(schema, {
        inlineEnvironmentVariable: inlineVariable,
        pathEnvironmentVariable: pathVariable,
      }),
    ).toEqual({ value: "file" });
  });

  it("rejects missing and invalid configuration", () => {
    expect(() =>
      loadConfig(schema, {
        inlineEnvironmentVariable: inlineVariable,
        pathEnvironmentVariable: pathVariable,
      }),
    ).toThrow("No configuration found");

    process.env[inlineVariable] = '{"value":""}';
    expect(() =>
      loadConfig(schema, {
        inlineEnvironmentVariable: inlineVariable,
        pathEnvironmentVariable: pathVariable,
      }),
    ).toThrow();
  });

  it("reads and trims a secret file", () => {
    const path = join(directory, "secret");
    writeFileSync(path, "synthetic-secret\n");
    process.env[secretVariable] = path;

    expect(readSecretFile(secretVariable)).toBe("synthetic-secret");
  });
});
