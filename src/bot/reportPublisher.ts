import { createLogger } from "../utils/logger.js";
import { renderRunReport, type RunReport } from "./runReport.js";

const logger = createLogger("report");

export interface ReportTransport {
  send(text: string): Promise<number | undefined>;
  edit(messageId: number, text: string): Promise<void>;
}

export interface ReportPublisherOptions {
  transport?: ReportTransport;
  intervalMs?: number;
  render?: (report: RunReport) => string;
}

/**
 * Keeps a single message up to date with the run report.
 * Updates are throttled, coalesced and serialized (one in-flight request).
 */
export class ReportPublisher {
  private readonly transport?: ReportTransport;
  private readonly intervalMs: number;
  private readonly render: (report: RunReport) => string;

  private dirty = false;
  private messageId?: number;
  private lastText?: string;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private timer?: ReturnType<typeof setTimeout>;
  private pumping?: Promise<void>;
  private releaseWait?: () => void;
  private flushing = false;

  constructor(
    public readonly report: RunReport,
    {
      transport,
      intervalMs = 500,
      render = renderRunReport,
    }: ReportPublisherOptions = {},
  ) {
    this.transport = transport;
    this.intervalMs = intervalMs;
    this.render = render;
  }

  /**
   * Mutate the report and schedule a (throttled) message update.
   * @param logLine one-line description of the change, logged even without Telegram
   */
  update(mutator: (report: RunReport) => void, logLine?: string) {
    mutator(this.report);
    if (logLine) {
      logger(logLine);
    }
    this.dirty = true;
    this.schedule();
  }

  /** Publish the latest state and wait for all pending requests */
  async flush() {
    if (!this.transport) return;
    this.flushing = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.releaseWait?.();
    this.start();
    await this.pumping;
    this.flushing = false;
  }

  private schedule() {
    if (!this.transport || this.timer || this.pumping) return;
    const wait = Math.max(0, this.lastRequestAt + this.intervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.start();
    }, wait);
  }

  private start() {
    if (this.pumping) return;
    this.pumping = this.pump().finally(() => {
      this.pumping = undefined;
      // Updates that arrived during the last request
      if (this.dirty) this.schedule();
    });
  }

  private async pump() {
    const transport = this.transport!;
    while (this.dirty) {
      this.dirty = false;
      const text = this.render(this.report);
      if (text === this.lastText) continue;

      this.lastRequestAt = Date.now();
      try {
        if (this.messageId === undefined) {
          this.messageId = await transport.send(text);
        } else {
          await transport.edit(this.messageId, text);
        }
        this.lastText = text;
      } catch (e) {
        const retryAfter = getRetryAfterSeconds(e);
        if (retryAfter !== undefined) {
          logger(`Rate limited, retrying in ${retryAfter}s`);
          this.dirty = true;
          await this.wait(retryAfter * 1000, false);
          continue;
        }
        if (isNotModified(e)) {
          this.lastText = text;
        } else {
          logger("Failed to publish report", e);
        }
      }

      if (this.dirty) {
        await this.wait(this.lastRequestAt + this.intervalMs - Date.now());
      }
    }
  }

  private wait(ms: number, interruptible = true) {
    if (ms <= 0 || (interruptible && this.flushing)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      this.releaseWait = interruptible ? done : undefined;
      function done() {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}

function getResponse(e: unknown) {
  return (e as { response?: any } | undefined)?.response;
}

function getRetryAfterSeconds(e: unknown): number | undefined {
  const response = getResponse(e);
  if (response?.error_code !== 429) return undefined;
  const retryAfter = Number(response.parameters?.retry_after);
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1;
}

function isNotModified(e: unknown) {
  return String(getResponse(e)?.description ?? "").startsWith(
    "Bad Request: message is not modified",
  );
}
