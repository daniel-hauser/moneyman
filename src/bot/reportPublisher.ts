import { createLogger } from "../utils/logger.js";
import {
  isReportTruncated,
  renderFullReportText,
  renderRunReport,
  type RunReport,
} from "./runReport.js";

const defaultLogger = createLogger("report");

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_FILE_ATTEMPTS = 3;
const FILE_RETRY_DELAY_MS = 1000;

export interface PublisherStats {
  /** Calls to update() */
  updateCalls: number;
  /** Updates that did not result in a request of their own */
  coalescedUpdates: number;
  /** Successful sends + edits */
  requestsSent: number;
  sendCount: number;
  editCount: number;
  /** Frames not published because the render equals the last published text */
  skippedUnchanged: number;
  throttleWaits: number;
  totalThrottleWaitMs: number;
  /** 429 responses */
  rateLimited: number;
  totalRetryAfterMs: number;
  droppedAfterRetries: number;
  notModified: number;
  failures: number;
  renderErrors: number;
  /** Largest number of updates folded into a single request */
  maxUpdatesPerRequest: number;
  /** Peak number of update() calls in any 1s sliding window */
  maxUpdatesPerSecond: number;
  avgRequestLatencyMs: number;
  maxRequestLatencyMs: number;
  /** From the first update() to the end of the last request */
  durationMs: number;
  truncatedFrames: number;
  fileSent: boolean;
  fileAttempts: number;
}

export interface ReportTransport {
  send(text: string): Promise<number | undefined>;
  edit(messageId: number, text: string): Promise<void>;
  sendFile(filename: string, content: string): Promise<void>;
}

export interface ReportPublisherOptions {
  transport?: ReportTransport;
  intervalMs?: number;
  render?: (report: RunReport) => string;
  isTruncated?: (report: RunReport) => boolean;
  renderFull?: (report: RunReport) => string;
  log?: (message: string, ...args: unknown[]) => void;
}

/**
 * Keeps a single message up to date with the run report.
 * Updates are throttled, coalesced and serialized (one in-flight request).
 */
export class ReportPublisher {
  private readonly transport?: ReportTransport;
  private readonly intervalMs: number;
  private readonly render: (report: RunReport) => string;
  private readonly isTruncated: (report: RunReport) => boolean;
  private readonly renderFull: (report: RunReport) => string;
  private readonly log: (message: string, ...args: unknown[]) => void;
  private stats: PublisherStats = {
    updateCalls: 0,
    coalescedUpdates: 0,
    requestsSent: 0,
    sendCount: 0,
    editCount: 0,
    skippedUnchanged: 0,
    throttleWaits: 0,
    totalThrottleWaitMs: 0,
    rateLimited: 0,
    totalRetryAfterMs: 0,
    droppedAfterRetries: 0,
    notModified: 0,
    failures: 0,
    renderErrors: 0,
    maxUpdatesPerRequest: 0,
    maxUpdatesPerSecond: 0,
    avgRequestLatencyMs: 0,
    maxRequestLatencyMs: 0,
    durationMs: 0,
    truncatedFrames: 0,
    fileSent: false,
    fileAttempts: 0,
  };
  private pendingUpdates = 0;
  private recentUpdates: Array<number> = [];
  private totalLatencyMs = 0;
  private latencySamples = 0;
  private firstUpdateAt?: number;
  private lastRequestEndAt?: number;
  private statsLogged = false;
  private truncated = false;
  private fileSent = false;
  private fileSending = false;
  private rateLimited = 0;

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
      isTruncated = isReportTruncated,
      renderFull = renderFullReportText,
      log = defaultLogger,
    }: ReportPublisherOptions = {},
  ) {
    this.transport = transport;
    this.intervalMs = intervalMs;
    this.render = render;
    this.isTruncated = isTruncated;
    this.renderFull = renderFull;
    this.log = log;
  }

  /** A snapshot of the publishing counters */
  getStats(): PublisherStats {
    const { stats } = this;
    return {
      ...stats,
      avgRequestLatencyMs: this.latencySamples
        ? Math.round(this.totalLatencyMs / this.latencySamples)
        : 0,
      durationMs:
        this.firstUpdateAt !== undefined && this.lastRequestEndAt !== undefined
          ? this.lastRequestEndAt - this.firstUpdateAt
          : 0,
    };
  }

  /** Flush, send status.txt if needed and log the stats once */
  async finish() {
    await this.flush();
    await this.sendFullReportIfTruncated();
    if (!this.statsLogged) {
      this.statsLogged = true;
      this.log(`report stats ${JSON.stringify(this.getStats())}`);
    }
  }

  /**
   * Mutate the report and schedule a (throttled) message update.
   * @param logLine one-line description of the change, logged even without Telegram
   */
  update(mutator: (report: RunReport) => void, logLine?: string) {
    mutator(this.report);
    this.trackUpdate();
    if (logLine) {
      this.log(logLine);
    }
    this.dirty = true;
    this.schedule();
  }

  /** Publish the latest state and wait until nothing is pending */
  async flush() {
    if (!this.transport) return;
    this.flushing = true;
    try {
      while (this.pumping || this.dirty) {
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = undefined;
        }
        this.releaseWait?.();
        this.start();
        await this.pumping;
      }
    } finally {
      this.flushing = false;
    }
  }

  /**
   * If any published frame was truncated, send the full final report as
   * status.txt. Sends at most once (retrying failed uploads a few times).
   * Call after the final flush().
   */
  async sendFullReportIfTruncated() {
    if (!this.transport || !this.truncated || this.fileSent || this.fileSending)
      return;
    this.fileSending = true;
    try {
      this.log("Report was truncated, sending status.txt");
      const content = this.renderFull(this.report);
      for (let attempt = 1; attempt <= MAX_FILE_ATTEMPTS; attempt++) {
        try {
          this.stats.fileAttempts++;
          await this.transport.sendFile("status.txt", content);
          this.fileSent = true;
          this.stats.fileSent = true;
          return;
        } catch (e) {
          this.log(`Failed to send status.txt (attempt ${attempt})`, e);
          if (attempt < MAX_FILE_ATTEMPTS) {
            await this.wait(FILE_RETRY_DELAY_MS * attempt, false);
          }
        }
      }
    } catch (e) {
      this.log("Failed to render status.txt", e);
    } finally {
      this.fileSending = false;
    }
  }

  private trackUpdate() {
    const now = Date.now();
    this.stats.updateCalls++;
    this.pendingUpdates++;
    this.firstUpdateAt ??= now;
    this.recentUpdates.push(now);
    while (this.recentUpdates[0] <= now - 1000) this.recentUpdates.shift();
    this.stats.maxUpdatesPerSecond = Math.max(
      this.stats.maxUpdatesPerSecond,
      this.recentUpdates.length,
    );
  }

  /** Updates folded into a frame that was consumed without a request of its own */
  private consumePending(requested: boolean) {
    const pending = this.pendingUpdates;
    this.pendingUpdates = 0;
    if (requested) {
      this.stats.maxUpdatesPerRequest = Math.max(
        this.stats.maxUpdatesPerRequest,
        pending,
      );
      this.stats.coalescedUpdates += Math.max(0, pending - 1);
    } else {
      this.stats.coalescedUpdates += pending;
    }
  }

  private schedule() {
    if (!this.transport || this.timer || this.pumping) return;
    const wait = Math.max(0, this.lastRequestAt + this.intervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.trackThrottle(wait);
      this.start();
    }, wait);
  }

  private trackThrottle(ms: number) {
    if (ms <= 0) return;
    this.stats.throttleWaits++;
    this.stats.totalThrottleWaitMs += ms;
  }

  private start() {
    if (this.pumping) return;
    this.pumping = this.pump()
      .catch((e) => this.log("Report publishing failed", e))
      .finally(() => {
        this.pumping = undefined;
        // Updates that arrived during the last request
        if (this.dirty) this.schedule();
      });
  }

  private async pump() {
    const transport = this.transport!;
    while (this.dirty) {
      this.dirty = false;
      let text: string;
      try {
        text = this.render(this.report);
        if (text === this.lastText) {
          this.stats.skippedUnchanged++;
          this.consumePending(false);
          continue;
        }
        if (this.isTruncated(this.report)) {
          this.truncated = true;
          this.stats.truncatedFrames++;
        }
      } catch (e) {
        this.log("Failed to render report", e);
        this.stats.renderErrors++;
        this.consumePending(false);
        continue;
      }

      this.consumePending(true);
      this.lastRequestAt = Date.now();
      try {
        if (this.messageId === undefined) {
          this.messageId = await transport.send(text);
          this.stats.sendCount++;
        } else {
          await transport.edit(this.messageId, text);
          this.stats.editCount++;
        }
        this.stats.requestsSent++;
        this.trackLatency();
        this.lastText = text;
        this.rateLimited = 0;
      } catch (e) {
        this.trackLatency();
        const retryAfter = getRetryAfterSeconds(e);
        if (retryAfter !== undefined) {
          this.stats.rateLimited++;
          if (++this.rateLimited > MAX_RATE_LIMIT_RETRIES) {
            this.stats.droppedAfterRetries++;
            // Give up on this frame so flush() can't block on Telegram forever
            this.log("Rate limited too many times, dropping report update");
            this.rateLimited = 0;
            continue;
          }
          this.log(`Rate limited, retrying in ${retryAfter}s`);
          this.dirty = true;
          this.stats.totalRetryAfterMs += retryAfter * 1000;
          await this.wait(retryAfter * 1000, false);
          continue;
        }
        if (isNotModified(e)) {
          this.stats.notModified++;
          this.lastText = text;
        } else {
          this.stats.failures++;
          this.log("Failed to publish report", e);
        }
      }

      if (this.dirty) {
        const throttleMs = this.lastRequestAt + this.intervalMs - Date.now();
        const waitStart = Date.now();
        await this.wait(throttleMs);
        if (throttleMs > 0) {
          this.stats.throttleWaits++;
          this.stats.totalThrottleWaitMs += Date.now() - waitStart;
        }
      }
    }
  }

  private trackLatency() {
    const now = Date.now();
    const latency = now - this.lastRequestAt;
    this.lastRequestEndAt = now;
    this.totalLatencyMs += latency;
    this.latencySamples++;
    this.stats.maxRequestLatencyMs = Math.max(
      this.stats.maxRequestLatencyMs,
      latency,
    );
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
