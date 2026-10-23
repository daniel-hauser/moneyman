import {
  addDays,
  setHours,
  setMilliseconds,
  setMinutes,
  setSeconds,
} from "date-fns";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("scheduler");

export type TimeOfDay = { hours: number; minutes: number };

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Parse a `HH:mm` string into its 24 hour components.
 * @throws if the string is not a valid time of day
 */
export function parseTimeOfDay(time: string): TimeOfDay {
  const match = TIME_OF_DAY_PATTERN.exec(time);
  if (!match) {
    throw new Error(`Invalid time of day: ${time}. Expected the HH:mm format`);
  }
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

function atTimeOfDay(day: Date, { hours, minutes }: TimeOfDay): Date {
  return setMilliseconds(
    setSeconds(setMinutes(setHours(day, hours), minutes), 0),
    0,
  );
}

/**
 * The first moment a run should happen, strictly after `from`.
 *
 * Times are interpreted in the timezone of the process (`TZ`), which is what
 * `date-fns` does by default. Returns `undefined` when no times are configured.
 */
export function nextRunTime(
  times: readonly string[],
  from: Date = new Date(),
): Date | undefined {
  const candidates = times.flatMap((time) => {
    const timeOfDay = parseTimeOfDay(time);
    return [0, 1]
      .map((dayOffset) => atTimeOfDay(addDays(from, dayOffset), timeOfDay))
      .filter((candidate) => candidate.getTime() > from.getTime());
  });

  if (!candidates.length) return undefined;

  return candidates.sort((a, b) => a.getTime() - b.getTime())[0];
}

/**
 * Runs `run` at every configured time of day, then re-arms itself for the next
 * one. It is intentionally dumb about timezones and daylight saving: the next
 * occurrence is recomputed from the current time after every run.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private next: Date | undefined;

  constructor(
    private readonly times: readonly string[],
    private readonly run: () => Promise<unknown>,
  ) {}

  /** The time of the next scheduled run, if any */
  get nextRunAt(): Date | undefined {
    return this.next;
  }

  start(): void {
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.next = undefined;
  }

  private scheduleNext(): void {
    this.next = nextRunTime(this.times);
    if (!this.next) {
      logger("No run times configured, expecting manual runs only");
      return;
    }

    const delay = this.next.getTime() - Date.now();
    logger(
      `Next scheduled run at ${this.next.toISOString()} (in ${Math.round(
        delay / 1000,
      )}s)`,
    );

    this.timer = setTimeout(() => void this.fire(), delay);
  }

  private async fire(): Promise<void> {
    this.timer = undefined;
    logger("Scheduled run is starting");

    try {
      await this.run();
    } catch (e) {
      logger("Scheduled run failed", e);
    } finally {
      this.scheduleNext();
    }
  }
}
