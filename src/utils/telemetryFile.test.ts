import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

it("persists standard JSONL with private permissions without writing public output", async () => {
  const path = join(process.cwd(), `.otel-file-test-${process.pid}.jsonl`);
  const env = process.env;
  process.env = { ...env, MONEYMAN_TELEMETRY_FILE_PATH: path };
  const stdout = jest.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = jest.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    writeFileSync(path, "", { mode: 0o644 });
    const {
      privateTelemetrySink,
      withDeliveryTelemetry,
      inSpan,
      flushTelemetry,
      privateDeliveryTelemetryPath,
      deliveryTelemetryLimit,
    } = await import("./telemetry.js");
    privateTelemetrySink.write(Buffer.from('{"resourceSpans":[]}'));
    privateTelemetrySink.write(Buffer.from('{"resourceLogs":[]}'));
    expect(readFileSync(path, "utf8")).toBe(
      '{"resourceSpans":[]}\n{"resourceLogs":[]}\n',
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
    await withDeliveryTelemetry(() =>
      inSpan("delivery", async () => {}, { "run.id": "invented-run" }),
    );
    await flushTelemetry();
    expect(readFileSync(path, "utf8")).toBe(
      '{"resourceSpans":[]}\n{"resourceLogs":[]}\n',
    );
    const delivery = JSON.parse(
      readFileSync(privateDeliveryTelemetryPath, "utf8"),
    ).resourceSpans[0].scopeSpans[0].spans[0];
    expect(delivery.name).toBe("delivery");
    expect(delivery.endTimeUnixNano).not.toBe("0");
    expect(statSync(privateDeliveryTelemetryPath).mode & 0o777).toBe(0o600);
    writeFileSync(
      privateDeliveryTelemetryPath,
      "x".repeat(deliveryTelemetryLimit),
      { mode: 0o600 },
    );
    await withDeliveryTelemetry(async () =>
      privateTelemetrySink.write(Buffer.from('{"resourceLogs":[]}')),
    );
    expect(readFileSync(privateDeliveryTelemetryPath, "utf8")).toBe(
      '{"resourceLogs":[]}\n',
    );
    expect(statSync(privateDeliveryTelemetryPath).size).toBeLessThan(
      deliveryTelemetryLimit,
    );
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  } finally {
    process.env = env;
    rmSync(path, { force: true });
    rmSync(path.replace(/(?:\.otel)?\.jsonl$/, "") + ".delivery.otel.jsonl", {
      force: true,
    });
    jest.restoreAllMocks();
  }
});

it.each(["success", "failure"])(
  "writes exactly zero actual stdout/stderr bytes on telemetry %s",
  async (mode) => {
    const path = join(process.cwd(), `.otel-subprocess-${process.pid}.jsonl`);
    const script = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
          import { createLogger } from "./src/utils/logger.ts";
          import { flushTelemetry, shutdownTelemetry, TELEMETRY_EXPORT_FAILURE } from "./src/utils/telemetry.ts";
          await createLogger("fixture").span({ name: "operation" }, async () => {
            createLogger("fixture")("invented private diagnostic");
          });
          let failed = false;
          try { await flushTelemetry(); }
          catch (error) {
            if (error.message !== TELEMETRY_EXPORT_FAILURE) process.exit(2);
            failed = true;
          }
          await shutdownTelemetry();
          if (failed !== ${mode === "failure"}) process.exit(3);
        `,
      },
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
      write: false,
    });
    try {
      const result = spawnSync(process.execPath, ["--input-type=module"], {
        input: script.outputFiles[0].text,
        encoding: "utf8",
        env: {
          ...process.env,
          DEBUG: "moneyman:fixture",
          MONEYMAN_UNSAFE_STDOUT: "false",
          MONEYMAN_TELEMETRY_FILE_PATH:
            mode === "failure" ? `${path}/invented-private-secret` : path,
        },
      });
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");
      expect(result.status).toBe(0);
    } finally {
      rmSync(path, { force: true });
    }
  },
);
