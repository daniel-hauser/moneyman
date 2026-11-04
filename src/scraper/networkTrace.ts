import type { Browser, CDPSession, Protocol } from "puppeteer";

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
        /token|secret|password|credential|auth|session|api[-_]?key|code/i.test(
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

function responseMetadata(response: Protocol.Network.Response) {
  return {
    status: response.status,
    statusText: response.statusText,
    mimeType: response.mimeType,
    headers: Object.fromEntries(
      Object.entries(response.headers).map(([name, value]) => [
        name,
        /authorization|cookie|token|secret|api[-_]?key/i.test(name)
          ? "[redacted]"
          : /^(location|content-location)$/i.test(name)
            ? redactUrl(String(value), response.url)
            : value,
      ]),
    ),
    timing: response.timing,
    fromDiskCache: response.fromDiskCache,
    fromServiceWorker: response.fromServiceWorker,
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
  let closing: Promise<string> | undefined;
  return {
    close() {
      return (closing ??= (async () => {
        stopping = true;
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
          format: "moneyman-browser-network-v2",
          companyId: "visaCal",
          scope:
            "Browser Network events only; excludes Node fetch and WebSocket frames.",
          privacy:
            "PRIVATE: raw response text may contain personal data. No request headers/bodies. Sensitive response headers and credential/token URL query values redacted; fragments omitted.",
          limits: {
            maxEntries,
            maxBodyBytes,
            maxTotalBodyBytes,
            concurrentBodyReads: 4,
            cdpResourceBufferBytes: 1024 * 1024,
          },
          droppedEntries,
          errors,
          entries,
        });
      })());
    },
  };
}
