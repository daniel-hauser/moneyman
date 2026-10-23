import { BooleanEnvVarSchema } from "../config.schema.js";

/**
 * When `true`, moneyman keeps running after the first scrape: it runs on the
 * times configured in `options.scheduling.times` and accepts commands over
 * Telegram (`/scrape`, `/status`) instead of running once and exiting.
 *
 * The docker entrypoint uses the same variable to pick its default command.
 */
export const longRunning = BooleanEnvVarSchema.parse(
  process.env.MONEYMAN_LONG_RUNNING,
);
