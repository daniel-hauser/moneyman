import { createLogger } from "../utils/logger.js";
import {
  isReportTruncated,
  renderFullReportText,
  renderRunReport,
  type RunReport,
} from "./runReport.js";

const logger = createLogger("report");

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_FILE_ATTEMPTS = 3;
const FILE_RETRY_DELAY_MS = 1000;

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
    }: ReportPublisherOptions = {},
  ) {
    this.transport = transport;
    this.intervalMs = intervalMs;
    this.render = render;
    this.isTruncated = isTruncated;
    this.renderFull = renderFull;
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
      logger("Report was truncated, sending status.txt");
      const content = this.renderFull(this.report);
      for (let attempt = 1; attempt <= MAX_FILE_ATTEMPTS; attempt++) {
        try {
          await this.transport.sendFile("status.txt", content);
          this.fileSent = true;
          return;
        } catch (e) {
          logger(`Failed to send status.txt (attempt ${attempt})`, e);
          if (attempt < MAX_FILE_ATTEMPTS) {
            await this.wait(FILE_RETRY_DELAY_MS * attempt, false);
          }
        }
      }
    } catch (e) {
      logger("Failed to render status.txt", e);
    } finally {
      this.fileSending = false;
    }
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
    this.pumping = this.pump()
      .catch((e) => logger("Report publishing failed", e))
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
        if (text === this.lastText) continue;
        this.truncated ||= this.isTruncated(this.report);
      } catch (e) {
        logger("Failed to render report", e);
        continue;
      }

      this.lastRequestAt = Date.now();
      try {
        if (this.messageId === undefined) {
          this.messageId = await transport.send(text);
        } else {
          await transport.edit(this.messageId, text);
        }
        this.lastText = text;
        this.rateLimited = 0;
      } catch (e) {
        const retryAfter = getRetryAfterSeconds(e);
        if (retryAfter !== undefined) {
          if (++this.rateLimited > MAX_RATE_LIMIT_RETRIES) {
            // Give up on this frame so flush() can't block on Telegram forever
            logger("Rate limited too many times, dropping report update");
            this.rateLimited = 0;
            continue;
          }
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
