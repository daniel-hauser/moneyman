import { Context, Telegraf } from "telegraf";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import type { RunStatus } from "../runner.js";

const logger = createLogger("commands");

/**
 * The first entry is the one advertised in the Telegram command menu, the rest
 * are kept as aliases for convenience.
 */
export const SCRAPE_COMMANDS = ["scrape", "fetch"];

export const BOT_COMMANDS = [
  { command: SCRAPE_COMMANDS[0], description: "Run a scrape now" },
  { command: "status", description: "Show the last run and the next one" },
  { command: "help", description: "List the available commands" },
];

export const HELP_MESSAGE = [
  "Moneyman is running and listening for commands:",
  "",
  ...BOT_COMMANDS.map(
    ({ command, description }) => `/${command} — ${description}`,
  ),
].join("\n");

export type CommandHandlers = {
  /**
   * Start a scrape. Resolves with the message to reply to the user with, which
   * may report that a run was already in progress.
   */
  scrape: () => Promise<string>;
  isRunning: () => boolean;
  getLastRun: () => RunStatus | undefined;
  getNextRunAt: () => Date | undefined;
};

export function isAuthorizedChat(ctx: Context): boolean {
  const chatId = config.options.notifications?.telegram?.chatId;
  return Boolean(chatId) && ctx.chat?.id?.toString() === chatId;
}

export function formatStatus(
  handlers: Pick<CommandHandlers, "isRunning" | "getLastRun" | "getNextRunAt">,
): string {
  const lines = [
    handlers.isRunning() ? "🔄 A scrape is running right now" : "😴 Idle",
  ];

  const lastRun = handlers.getLastRun();
  if (lastRun) {
    lines.push(
      `${lastRun.failed ? "❌" : "✅"} Last run (${lastRun.trigger}) started at ${formatDate(
        lastRun.startedAt,
      )}, took ${Math.round(
        (lastRun.endedAt.getTime() - lastRun.startedAt.getTime()) / 1000,
      )}s`,
    );
  } else {
    lines.push("No run finished in this process yet");
  }

  const nextRunAt = handlers.getNextRunAt();
  lines.push(
    nextRunAt
      ? `⏰ Next scheduled run at ${formatDate(nextRunAt)}`
      : "⏰ No scheduled run configured, only manual runs",
  );

  return lines.join("\n");
}

function formatDate(date: Date): string {
  return date.toLocaleString("en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Register the Moneyman commands on an already configured Telegram bot.
 * Only the configured chat ID is allowed to trigger anything.
 */
export function registerCommands(
  bot: Telegraf<Context>,
  handlers: CommandHandlers,
) {
  /**
   * A long running process must not die because one update failed to be
   * handled: log it instead of letting telegraf rethrow.
   */
  bot.catch((e) => logger(`Unhandled error while processing an update`, e));

  const guarded = (name: string, handler: (ctx: Context) => Promise<void>) => {
    bot.command(name, async (ctx) => {
      if (!isAuthorizedChat(ctx)) {
        logger(`Ignoring /${name} from unauthorized chat ${ctx.chat?.id}`);
        return;
      }

      try {
        await handler(ctx);
      } catch (e) {
        logger(`Failed to handle /${name}`, e);
        await ctx.reply(`❌ Failed to handle /${name}`).catch(() => {});
      }
    });
  };

  for (const command of SCRAPE_COMMANDS) {
    guarded(command, async (ctx) => {
      await ctx.reply(await handlers.scrape());
    });
  }

  guarded("status", async (ctx) => {
    await ctx.reply(formatStatus(handlers));
  });

  guarded("help", async (ctx) => {
    await ctx.reply(HELP_MESSAGE);
  });

  bot.telegram
    .setMyCommands(BOT_COMMANDS)
    .catch((e) => logger("Failed to set the Telegram command menu", e));
}
