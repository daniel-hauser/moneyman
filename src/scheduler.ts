import { schedule, type ScheduledTask } from "node-cron";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("scheduler");

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Turn a `HH:mm` time of day into the daily cron expression node-cron expects.
 * @throws if the string is not a valid time of day
 */
export function toCronExpression(time: string): string {
  const match = TIME_OF_DAY_PATTERN.exec(time);
  if (!match) {
    throw new Error(`Invalid time of day: ${time}. Expected the HH:mm format`);
  }

  const [, hours, minutes] = match;
  return `${Number(minutes)} ${Number(hours)} * * *`;
}

/**
 * Runs `run` at every configured time of day. The schedule itself belongs to
 * node-cron, in the timezone of the process (`TZ`), and the next run is read
 * back from it for `/status`.
 */
export class Scheduler {
  private tasks: ScheduledTask[] = [];

  constructor(
    private readonly times: readonly string[],
    private readonly run: () => Promise<unknown>,
  ) {}

  /** The time of the next scheduled run, if any */
  get nextRunAt(): Date | undefined {
    const upcoming = this.tasks
      .map((task) => task.getNextRun())
      .filter((date): date is Date => date !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    return upcoming[0];
  }

  start(): void {
    if (!this.times.length) {
      logger("No run times configured, expecting manual runs only");
      return;
    }

    this.tasks = this.times.map((time) => {
      const expression = toCronExpression(time);
      logger(`Scheduling a run at ${time} (${expression})`);

      return schedule(expression, () => this.fire());
    });
  }

  stop(): void {
    for (const task of this.tasks) {
      task.stop();
    }

    this.tasks = [];
  }

  private async fire(): Promise<void> {
    logger("Scheduled run is starting");

    try {
      await this.run();
    } catch (e) {
      logger("Scheduled run failed", e);
    }
  }
}
