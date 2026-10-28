import { BooleanEnvVarSchema } from "../config.schema.js";

/**
 * When `true`, moneyman keeps running after the first scrape: it runs on the
 * times configured in `options.scheduling.times` and accepts commands over
 * Telegram (`/scrape`, `/status`) instead of running once and exiting.
 *
 * This is the input of the entry dispatcher (`src/start.js`). The rest of the
 * app asks `isLongRunning()` instead, so that a process started as the long
 * running server behaves like one even when the variable was not set.
 */
export const longRunning = BooleanEnvVarSchema.parse(
  process.env.MONEYMAN_LONG_RUNNING,
);

/**
 * Whether this process runs the long running server. Set by the server entry
 * point, because the log file is handled differently: a long lived process
 * shares one file between runs and empties it between them, while a one shot
 * process deletes it when it is done.
 */
let longRunningProcess = false;

export function markLongRunningProcess() {
  longRunningProcess = true;
}

export function isLongRunning(): boolean {
  return longRunningProcess;
}
