import type { Browser, CDPSession, Protocol } from "puppeteer";
import { aborted } from "node:util";
import { loggerContextStore } from "../utils/asyncContext.js";

const maxEntries = 5_000;
const maxBodyBytes = 64 * 1024;
const maxTotalBodyBytes = 4 * 1024 * 1024;
const commandTimeout = { timeout: 1_500 };
const autoAttach = {
  autoAttach: true,
  waitForDebuggerOnStart: true,
  flatten: true,
};

function redactUrl(value: string, base?: string) {
  try {
    const url = new URL(value, base);
    if (url.username) url.username = "[redacted]";
    if (url.password) url.password = "[redacted]";
    for (const key of [...url.searchParams.keys()]) {
      if (
        /token|secret|password|credential|auth|session|api[-_]?key|code|card/i.test(
          key,
        )
      )
        url.searchParams.set(key, "[redacted]");
    }
    url.hash = "";
    return url.href;
  } catch {
    return "[invalid URL]";
  }
}

function headerMetadata(headers: Record<string, string>, url: string) {
  const authorization = Object.entries(headers).find(([name]) =>
    /^authorization$/i.test(name),
  )?.[1];
  return {
    headers: Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [
        name,
        /authorization|cookie|token|secret|password|credential|api[-_]?key|card/i.test(
          name,
        )
          ? "[redacted]"
          : /^(location|content-location|referer)$/i.test(name)
            ? redactUrl(value, url)
            : value,
      ]),
    ),
    authorizationPresent: authorization !== undefined,
    authorizationScheme: authorization?.match(/^(\S+)\s+\S/)?.[1],
  };
}

function responseMetadata(response: Protocol.Network.Response) {
  return {
    status: response.status,
    statusText: response.statusText,
    mimeType: response.mimeType,
    ...headerMetadata(response.headers, response.url),
    timing: response.timing,
    fromDiskCache: response.fromDiskCache,
    fromServiceWorker: response.fromServiceWorker,
  };
}

function payloadShape(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (depth >= 5) return { type: typeof value, reason: "Shape depth limit" };
  if (Array.isArray(value))
    return {
      type: "array",
      count: value.length,
      firstItem: value.length ? payloadShape(value[0], depth + 1) : undefined,
    };
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([key, item]) => [key, payloadShape(item, depth + 1)]),
    );
  return typeof value;
}

function requestBodyMetadata(body: RequestInit["body"]) {
  if (body == null) return { type: "none" };
  if (typeof body === "string" && Buffer.byteLength(body) <= maxBodyBytes) {
    try {
      return { type: "json", shape: payloadShape(JSON.parse(body)) };
    } catch {
      return { type: "text", bytes: Buffer.byteLength(body) };
    }
  }
  if (body instanceof URLSearchParams)
    return { type: "urlencoded", fields: [...new Set(body.keys())] };
  return { type: "omitted", reason: "Non-JSON, large or streaming body" };
}

interface NodeEntry {
  id: number;
  context?: string;
  startedAt: string;
  url?: string;
  method?: string;
  request?: ReturnType<typeof headerMetadata> & {
    body: ReturnType<typeof requestBodyMetadata>;
  };
  response?: ReturnType<typeof headerMetadata> & {
    status: number;
    statusText: string;
    url: string;
    redirected: boolean;
    type: ResponseType;
  };
  responseTimeMs?: number;
  durationMs?: number;
  outcome: string;
  failure?: string;
  body?: Entry["body"];
}

/** Scoped to one isolated scraper worker; never log this trace publicly. */
export function recordNodeFetch() {
  const originalFetch = globalThis.fetch;
  const entries: NodeEntry[] = [];
  const errors: string[] = [];
  const pending = new Set<Promise<void>>();
  let bodyBytes = 0;
  let droppedEntries = 0;

  async function captureBody(
    response: Response,
    entry: NodeEntry,
    start: number,
  ) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      reader = response.clone().body?.getReader();
      if (!reader) {
        entry.body = { text: "", truncated: false };
        return;
      }
      const deadline = AbortSignal.timeout(3_000);
      const timeout = aborted(deadline, reader).then(() => {
        throw deadline.reason;
      });
      while (true) {
        const { done, value } = await Promise.race([reader.read(), timeout]);
        if (done) {
          entry.body = {
            text: Buffer.concat(chunks).toString("utf8"),
            truncated: false,
          };
          break;
        }
        const limit = Math.min(
          maxBodyBytes - bytes,
          maxTotalBodyBytes - bodyBytes,
        );
        const chunk = Buffer.from(value.subarray(0, limit));
        chunks.push(chunk);
        bytes += chunk.length;
        bodyBytes += chunk.length;
        if (value.length >= limit) {
          entry.body = {
            text: Buffer.concat(chunks).toString("utf8"),
            truncated: true,
            reason: "Node body byte limit",
          };
          break;
        }
      }
    } catch (error) {
      entry.body = {
        text: Buffer.concat(chunks).toString("utf8"),
        truncated: true,
        reason: String(error),
      };
    } finally {
      entry.durationMs = performance.now() - start;
      void reader
        ?.cancel()
        .catch((error) => errors.push(`Node body cancel: ${error}`));
    }
  }

  globalThis.fetch = async (input, init) => {
    if (entries.length >= maxEntries) {
      droppedEntries++;
      return originalFetch(input, init);
    }
    const start = performance.now();
    const entry: NodeEntry = {
      id: entries.length + 1,
      context: loggerContextStore.getStore()?.prefix,
      startedAt: new Date().toISOString(),
      outcome: "pending",
    };
    entries.push(entry);
    const completion = Promise.withResolvers<void>();
    pending.add(completion.promise);
    const finish = () => {
      pending.delete(completion.promise);
      completion.resolve();
    };
    try {
      const request = input instanceof Request ? input : undefined;
      const url = request?.url ?? String(input);
      entry.url = redactUrl(url);
      entry.method = init?.method ?? request?.method ?? "GET";
      entry.request = {
        ...headerMetadata(
          Object.fromEntries(new Headers(init?.headers ?? request?.headers)),
          url,
        ),
        body:
          init?.body === undefined && request?.body
            ? { type: "omitted", reason: "Request stream not consumed" }
            : requestBodyMetadata(init?.body),
      };
    } catch (error) {
      errors.push(`Node request ${entry.id} metadata: ${error}`);
    }
    let response: Response;
    try {
      response = await originalFetch(input, init);
    } catch (error) {
      entry.durationMs = performance.now() - start;
      entry.outcome = "failed";
      entry.failure = `${error}${error instanceof Error && error.cause ? `; cause: ${error.cause}` : ""}`;
      finish();
      throw error;
    }
    entry.responseTimeMs = performance.now() - start;
    entry.outcome = response.ok ? "finished" : "http-error";
    try {
      entry.response = {
        status: response.status,
        statusText: response.statusText,
        url: redactUrl(response.url),
        redirected: response.redirected,
        type: response.type,
        ...headerMetadata(Object.fromEntries(response.headers), response.url),
      };
    } catch (error) {
      errors.push(`Node response ${entry.id} metadata: ${error}`);
    }
    void captureBody(response, entry, start).finally(finish);
    return response;
  };
  return {
    async close() {
      globalThis.fetch = originalFetch;
      const completed = await Promise.race([
        Promise.allSettled([...pending]).then(() => true),
        aborted(AbortSignal.timeout(3_500), pending).then(() => false),
      ]);
      if (!completed) errors.push("Node fetch shutdown deadline exceeded");
      for (const entry of entries) {
        if (entry.outcome === "pending") entry.outcome = "unfinished-at-stop";
        entry.body ??= {
          truncated: true,
          reason: entry.response
            ? "Node body unfinished at shutdown"
            : `No response body: ${entry.outcome}`,
        };
      }
      return { entries, errors, droppedEntries, bodyBytes };
    },
  };
}

interface Entry {
  id: number;
  target: string;
  targetType: string;
  requestId: string;
  frameId?: string;
  redirectedFrom?: number;
  url: string;
  method: string;
  request: ReturnType<typeof headerMetadata>;
  type?: Protocol.Network.ResourceType;
  startedAt: string;
  timestamp: number;
  response?: ReturnType<typeof responseMetadata>;
  durationMs?: number;
  encodedBytes?: number;
  outcome: string;
  failure?: string;
  blockedReason?: Protocol.Network.BlockedReason;
  corsError?: Protocol.Network.CorsErrorStatus;
  body?: { text?: string; truncated: boolean; reason?: string };
}

/**
 * Pause new pages/frames only until Network is enabled, including OOPIFs.
 * The returned trace is sensitive: deliver only through private report logs.
 */
export async function recordBrowserNetwork(browser: Browser) {
  const root = await browser.target().createCDPSession();
  const entries: Entry[] = [];
  const errors: string[] = [];
  const pending = new Set<Promise<void>>();
  const sessions = new Map<CDPSession, CDPSession>();
  const seen = new Set<string>();
  // OOPIF navigations can start in a parent and finish in the child session.
  const requests = new Map<string, Entry>();
  let droppedEntries = 0;
  let bodyReads = 0;
  let bodyBytes = 0;
  let stopping = false;
  const track = (task: Promise<void>) => {
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  const cleanup = async (session: CDPSession, detach = false) => {
    const parent = sessions.get(session);
    if (session.detached || parent?.detached) return;
    try {
      if (detach) {
        await (session === root ? root.connection() : parent)?.send(
          "Target.detachFromTarget",
          { sessionId: session.id() },
          commandTimeout,
        );
        sessions.delete(session);
      } else {
        await session.send(
          "Runtime.runIfWaitingForDebugger",
          undefined,
          commandTimeout,
        );
      }
    } catch (error) {
      if (!session.detached && !parent?.detached)
        errors.push(
          `${session.id()} ${detach ? "detach" : "resume"}: ${error}`,
        );
    }
  };
  async function attach(session: CDPSession, parent = root) {
    sessions.set(session, parent);
    if (stopping) {
      await cleanup(session);
      await cleanup(session, true);
      return;
    }
    session.on("sessionattached", (child) => track(attach(child, session)));
    session.on("sessiondetached", (child) => sessions.delete(child));
    try {
      const { targetInfo } = await session.send(
        "Target.getTargetInfo",
        {},
        commandTimeout,
      );
      if (stopping) return;
      if (targetInfo.type !== "tab") {
        session.on("Network.requestWillBeSent", (event) => {
          const key = `${event.requestId}:${event.timestamp}`;
          if (seen.has(key)) return;
          const previous = requests.get(event.requestId);
          if (previous && event.redirectResponse) {
            previous.response = responseMetadata(event.redirectResponse);
            previous.outcome = "redirect";
            previous.durationMs = (event.timestamp - previous.timestamp) * 1000;
          }
          if (entries.length >= maxEntries) {
            droppedEntries++;
            requests.delete(event.requestId);
            return;
          }
          const entry: Entry = {
            id: entries.length + 1,
            target: session.id(),
            targetType: targetInfo.type,
            requestId: event.requestId,
            frameId: event.frameId,
            redirectedFrom: event.redirectResponse ? previous?.id : undefined,
            url: redactUrl(event.request.url),
            method: event.request.method,
            request: headerMetadata(event.request.headers, event.request.url),
            type: event.type,
            startedAt: new Date(event.wallTime * 1000).toISOString(),
            timestamp: event.timestamp,
            outcome: "pending",
          };
          entries.push(entry);
          seen.add(key);
          requests.set(event.requestId, entry);
        });
        session.on("Network.responseReceived", (event) => {
          const entry = requests.get(event.requestId);
          if (entry) entry.response = responseMetadata(event.response);
        });
        session.on("Network.loadingFailed", (event) => {
          const entry = requests.get(event.requestId);
          if (!entry) return;
          entry.outcome = "failed";
          entry.durationMs = (event.timestamp - entry.timestamp) * 1000;
          entry.failure = event.errorText;
          entry.blockedReason = event.blockedReason;
          entry.corsError = event.corsErrorStatus;
          requests.delete(event.requestId);
        });
        session.on("Network.loadingFinished", (event) => {
          const entry = requests.get(event.requestId);
          if (!entry) return;
          requests.delete(event.requestId);
          entry.outcome = "finished";
          entry.durationMs = (event.timestamp - entry.timestamp) * 1000;
          entry.encodedBytes = event.encodedDataLength;
          if (
            !/^(text\/)|json|javascript|xml/i.test(
              entry.response?.mimeType ?? "",
            )
          ) {
            entry.body = { truncated: true, reason: "Non-text body omitted" };
            return;
          }
          if (bodyReads >= 4 || bodyBytes >= maxTotalBodyBytes || stopping) {
            entry.body = {
              truncated: true,
              reason:
                "Body omitted: concurrency/total-byte limit or recorder stopping",
            };
            return;
          }
          bodyReads++;
          track(
            (async () => {
              try {
                const result = await session.send(
                  "Network.getResponseBody",
                  { requestId: event.requestId },
                  commandTimeout,
                );
                const bytes = Buffer.from(
                  result.body,
                  result.base64Encoded ? "base64" : "utf8",
                );
                const limit = Math.min(
                  maxBodyBytes,
                  maxTotalBodyBytes - bodyBytes,
                );
                const text = bytes.subarray(0, limit).toString("utf8");
                bodyBytes += Math.min(bytes.length, limit);
                entry.body = {
                  text,
                  truncated: bytes.length > limit,
                  reason: bytes.length > limit ? "Body byte limit" : undefined,
                };
              } catch (error) {
                entry.body = { truncated: true, reason: String(error) };
              } finally {
                bodyReads--;
              }
            })(),
          );
        });
        await session.send(
          "Network.enable",
          {
            maxTotalBufferSize: 4 * 1024 * 1024,
            maxResourceBufferSize: 1024 * 1024,
            maxPostDataSize: 0,
          },
          commandTimeout,
        );
      }
      await session.send("Target.setAutoAttach", autoAttach, commandTimeout);
    } catch (error) {
      errors.push(`${session.id()} attach: ${error}`);
    } finally {
      await cleanup(session);
    }
  }
  root.on("sessionattached", (session) => track(attach(session)));
  root.on("sessiondetached", (session) => sessions.delete(session));
  try {
    await root.send("Target.setAutoAttach", autoAttach, commandTimeout);
  } catch (error) {
    stopping = true;
    await Promise.allSettled([...pending]);
    await Promise.all(
      [...sessions.keys()].map((session) => cleanup(session, true)),
    );
    await cleanup(root, true);
    throw error;
  }
  const nodeRecording = recordNodeFetch();
  let closing: Promise<string> | undefined;
  return {
    close() {
      return (closing ??= (async () => {
        stopping = true;
        const nodeTrace = nodeRecording.close();
        try {
          await root.send(
            "Target.setAutoAttach",
            { ...autoAttach, autoAttach: false, waitForDebuggerOnStart: false },
            commandTimeout,
          );
        } catch (error) {
          errors.push(`Disable auto-attach: ${error}`);
        } finally {
          // A snapshot prevents new targets from extending shutdown indefinitely.
          await Promise.allSettled([...pending]);
          await Promise.all(
            [...sessions.keys()].map((session) => cleanup(session, true)),
          );
          await cleanup(root, true);
        }
        for (const entry of entries) {
          if (entry.outcome === "pending") entry.outcome = "unfinished-at-stop";
          entry.body ??= {
            truncated: true,
            reason: `No body: ${entry.outcome}`,
          };
        }
        return JSON.stringify({
          format: "moneyman-network-v3",
          companyId: "visaCal",
          scope:
            "Browser Network events and worker Node fetch; excludes WebSocket frames. Node request headers are supplied fetch headers, not automatically generated transport headers.",
          privacy:
            "PRIVATE: raw response text may contain personal data. Sensitive headers and URL query values redacted; fragments omitted. Request payloads contain field names, types and array counts only.",
          limits: {
            maxEntries,
            maxBodyBytes,
            maxTotalBodyBytes,
            concurrentBodyReads: 4,
            cdpResourceBufferBytes: 1024 * 1024,
            nodeMaxTotalBodyBytes: maxTotalBodyBytes,
            nodeBodyTimeoutMs: 3_000,
          },
          droppedEntries,
          errors,
          entries,
          nodeFetch: await nodeTrace,
        });
      })());
    },
  };
}
