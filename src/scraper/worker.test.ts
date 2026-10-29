import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { workerEnvironment } from "./environment.js";

const root = path.resolve(__dirname, "..", "..");
const scratch = path.join(root, `.scraper-worker-test-${process.pid}`);
const url = (...parts: string[]) =>
  pathToFileURL(path.join(root, ...parts)).href;

describe("native Comlink worker smoke test", () => {
  beforeAll(() => {
    execFileSync(
      process.execPath,
      [path.join(root, "node_modules", "typescript", "bin", "tsc")],
      { cwd: root },
    );
    mkdirSync(scratch, { recursive: true });
    writeFileSync(
      path.join(scratch, ".env"),
      "DOTENV_SENTINEL=must-not-load\nMONEYMAN_CONFIG=must-not-load\n",
    );
  }, 30000);
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("imports the production worker with isolated env, relays logs, and cancels before scraping on repeat runs", async () => {
    const bootstrap = `
      import assert from "node:assert/strict";
      const checkEnvironment = () => {
        for (const key of ["MONEYMAN_CONFIG", "MONEYMAN_CONFIG_PATH", "MONEYMAN_PUBLIC_LOG_FD",
          "TELEGRAM_TOKEN", "SECRET_PROVIDER_TOKEN", "BITWARDEN_ACCESS_TOKEN", "MONEYMAN_CONFIG_SECRET",
          "MONEYMAN_CONFIG_SECRET_ID", "MONEYMAN_CONFIG_SECRET_PROVIDER",
          "NODE_OPTIONS", "DOTENV_CONFIG_PATH", "DOTENV_SENTINEL"]) {
          assert.equal(process.env[key], undefined, key + " leaked into worker");
        }
      };
      checkEnvironment();
      await import(${JSON.stringify(url("dst", "scraper", "worker.js"))});
      checkEnvironment();
      console.log("worker smoke stdout");
      console.error("worker smoke stderr");
    `;
    // A separate cwd ensures any accidental dotenv loading sees only synthetic test data.
    const script = `
      import assert from "node:assert/strict";
      import { Worker, MessageChannel } from "node:worker_threads";
      import { once } from "node:events";
      import { wrap, proxy, releaseProxy, finalizer } from ${JSON.stringify(url("node_modules", "comlink", "dist", "esm", "comlink.mjs"))};
      import { workerEnvironment } from ${JSON.stringify(url("dst", "scraper", "environment.js"))};
      for (let run = 0; run < 2; run++) {
        await using resources = new AsyncDisposableStack();
        const { port1, port2 } = new MessageChannel();
        resources.defer(() => { port1.close(); port2.close(); });
        const worker = new Worker(new URL("data:text/javascript," + encodeURIComponent(${JSON.stringify(bootstrap)})), {
          workerData: port2,
          transferList: [port2],
          env: workerEnvironment({ ...process.env, MONEYMAN_CONFIG: "private", MONEYMAN_CONFIG_PATH: "private.json",
            MONEYMAN_PUBLIC_LOG_FD: "3", TELEGRAM_TOKEN: "private", SECRET_PROVIDER_TOKEN: "private",
            BITWARDEN_ACCESS_TOKEN: "private", MONEYMAN_CONFIG_SECRET: "private",
            MONEYMAN_CONFIG_SECRET_ID: "private", MONEYMAN_CONFIG_SECRET_PROVIDER: "bitwarden",
            NODE_OPTIONS: "--require dotenv/config", DOTENV_CONFIG_PATH: ".env" }),
          execArgv: [],
        });
        resources.defer(async () => { await worker.terminate(); });
        const listeners = new AbortController();
        resources.defer(() => listeners.abort());
        const api = wrap(port1);
        resources.defer(() => api[releaseProxy]());
        const exit = once(worker, "exit", { signal: listeners.signal });
        const rpc = (call) => Promise.race([call, exit.then(([code]) => {
          throw new Error("worker exited before RPC completed: " + code);
        })]);
        await rpc(api.cancel());
        const { promise: released, resolve: release } = Promise.withResolvers();
        await assert.rejects(rpc(api.scrape({
          accounts: [], startDate: new Date(), futureMonthsToScrape: 1, parallelScrapers: 1,
          additionalTransactionInformation: false, includeRawTransaction: true,
          executablePath: "nonexistent-smoke-browser", domainTracking: false,
          firewallSettings: [], blockByDefault: true, enableOtp: false, debugFilter: "",
        }, proxy({ [finalizer]: release }))), /cancelled/);
        await rpc(released);
      }
      console.log("native worker complete");
    `;
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: scratch,
        env: {
          ...workerEnvironment(process.env),
          TEMP: scratch,
          TMP: scratch,
          TMPDIR: scratch,
        },
        timeout: 20000,
      },
    );
    expect(stdout).toContain("native worker complete");
    expect(stdout.match(/worker smoke stdout/g)).toHaveLength(2);
    expect(stderr.match(/worker smoke stderr/g)).toHaveLength(2);
  }, 25000);
});
