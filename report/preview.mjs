import { context } from "esbuild";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { hashInlineContent } from "../src/bot/report/html.ts";

const root = new URL("../", import.meta.url);
const output = new URL("../dst/report-preview.generated.mjs", import.meta.url);
const port = Number(process.argv[2] ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Preview port must be an integer from 1 to 65535.");
}

await import("./build.mjs");
await mkdir(new URL("../dst/", import.meta.url), { recursive: true });

let currentHTML;
let revision;
const builder = await context({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ["report/preview.sample.ts"],
  outfile: fileURLToPath(output),
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "refresh-preview",
      setup(build) {
        build.onResolve({ filter: /\/assets\.generated\.js$/ }, () => ({
          path: fileURLToPath(
            new URL("../dst/bot/report/assets.generated.js", import.meta.url),
          ),
        }));
        build.onEnd(async (result) => {
          if (result.errors.length) return;
          try {
            const buildHash = createHash("sha256")
              .update(await readFile(output))
              .digest("hex");
            const { previewHTML } = await import(
              `${output.href}?build=${buildHash}`
            );
            currentHTML = previewHTML;
            revision = createHash("sha256").update(previewHTML).digest("hex");
            console.log(`Synthetic report ready (${revision.slice(0, 8)})`);
          } catch (error) {
            console.error(
              "Preview render failed; keeping the last working report.",
              error,
            );
          }
        });
      },
    },
  ],
});
await builder.rebuild();
if (!currentHTML) {
  await builder.dispose();
  throw new Error("Could not render the synthetic report.");
}
await builder.watch();

const styles =
  "body{margin:0;font:14px system-ui;background:#f5f5f5}header{padding:10px 16px}iframe{display:block;width:100%;height:calc(100dvh - 44px);border:0}";
const wrapper = () =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SYNTHETIC Moneyman preview</title><style>${styles}</style></head><body><header>SYNTHETIC sample data · Live preview · <a href="/report.html" target="_blank" rel="noopener">Open offline report</a></header><iframe title="Synthetic Moneyman report" src="/report.html" data-version="${revision}" sandbox="allow-scripts allow-downloads allow-popups"></iframe><script src="/preview.js"></script></body></html>`;
const client = `let revision = document.querySelector("iframe").dataset.version;
async function poll() {
  try {
    const response = await fetch("/version", { cache: "no-store" });
    if (!response.ok) throw new Error("Preview unavailable");
    const next = await response.text();
    if (revision !== next) {
      document.querySelector("iframe").src = "/report.html?v=" + next;
    }
    revision = next;
  } catch {}
  setTimeout(poll, 1000);
}
poll();`;

const server = createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  const routes = {
    "/": ["text/html; charset=utf-8", wrapper()],
    "/report.html": ["text/html; charset=utf-8", currentHTML],
    "/version": ["text/plain; charset=utf-8", revision],
    "/preview.js": ["text/javascript; charset=utf-8", client],
  };
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const route = Object.hasOwn(routes, path) ? routes[path] : undefined;
  if (!route) {
    response.writeHead(404).end("Not found");
    return;
  }
  if (path === "/") {
    response.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'self'; style-src ${hashInlineContent(styles)}; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'`,
    );
  }
  response.writeHead(200, { "Content-Type": route[0] });
  response.end(request.method === "HEAD" ? undefined : route[1]);
});

const assets = spawn(process.execPath, ["report/build.mjs", "--watch"], {
  cwd: fileURLToPath(root),
  stdio: "inherit",
});
assets.on("error", (error) => {
  console.error("Report asset watcher failed", error);
  shutdown();
});
assets.on("exit", (code, signal) => {
  if (!signal && code !== null) {
    console.error(`Report asset watcher exited (${code})`);
    shutdown();
  }
});

let closing;
function shutdown() {
  closing ??= (async () => {
    server.close();
    server.closeAllConnections();
    assets.kill();
    await builder.dispose();
  })();
  return closing;
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
server.on("error", async (error) => {
  console.error(error);
  process.exitCode = 1;
  await shutdown();
});
server.listen(port, "127.0.0.1", () => {
  console.log(
    `SYNTHETIC live preview: http://127.0.0.1:${port} (PID ${process.pid})`,
  );
});
