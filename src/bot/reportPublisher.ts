import { proxy, subscribe } from "valtio/vanilla";
import { createLogger } from "../utils/logger.js";
import { sleep } from "../utils/utils.js";
import {
  renderHTMLReport,
  renderRunReport,
  type RunReport,
} from "./runReport.js";

const defaultLog = createLogger("report");

export interface ReportTransport {
  send(text: string): Promise<number | undefined>;
  edit(messageId: number, text: string): Promise<void>;
  sendFile(filename: string, content: string): Promise<void>;
}

export interface ReportPublisherOptions {
  transport?: ReportTransport;
  intervalMs?: number;
  log?: (message: string, ...args: unknown[]) => void;
}

const response = (e: unknown) =>
  (e as { response?: any } | undefined)?.response;

/**
 * Returns a deeply reactive report: mutate it freely and the single Telegram
 * message is re-rendered and edited (throttled, one request in flight).
 * Call `finish()` once at the end of the run.
 */
export function createReportPublisher(
  initial: RunReport,
  {
    transport,
    intervalMs = 500,
    log = defaultLog,
  }: ReportPublisherOptions = {},
) {
  const report = proxy(initial);
  const stats = {
    renders: 0,
    requests: 0,
    skippedUnchanged: 0,
    rateLimited: 0,
    maxBurst: 0,
  };
  let messageId: number | undefined;
  let lastText: string | undefined;
  let lastRequestAt = 0;
  let dirty = false;
  let burst = 0;
  let running: Promise<void> | undefined;

  async function publishLatest() {
    while (dirty) {
      await sleep(Math.max(0, lastRequestAt + intervalMs - Date.now()));
      dirty = false;
      const text = renderRunReport(report);
      stats.renders++;
      if (text === lastText) {
        stats.skippedUnchanged++;
        continue;
      }
      try {
        lastRequestAt = Date.now();
        if (messageId === undefined) {
          messageId = await transport!.send(text);
        } else {
          await transport!.edit(messageId, text);
        }
        stats.requests++;
        stats.maxBurst = Math.max(stats.maxBurst, burst);
        burst = 0;
        lastText = text;
      } catch (e) {
        const { error_code, description, parameters } = response(e) ?? {};
        if (error_code === 429) {
          stats.rateLimited++;
          dirty = true;
          await sleep((Number(parameters?.retry_after) || 1) * 1000);
        } else if (
          String(description).startsWith("Bad Request: message is not modified")
        ) {
          lastText = text;
        } else {
          log("Failed to publish report", e);
        }
      }
    }
  }

  function kick() {
    if (running || !dirty) return;
    running = publishLatest()
      .catch((e) => log("Report publishing failed", e))
      .finally(() => {
        running = undefined;
      });
  }

  if (transport) {
    subscribe(report, (ops) => {
      burst += ops.length;
      dirty = true;
      kick();
    });
  }

  async function finish() {
    if (!transport) return;
    dirty = true;
    while (dirty || running) {
      kick();
      await running;
    }

    try {
      log("Sending report.html");
      await transport.sendFile("report.html", renderHTMLReport(report));
    } catch (e) {
      log("Failed to send report.html", e);
    }
    log(`report stats ${JSON.stringify(stats)}`);
  }

  return { report, finish };
}
