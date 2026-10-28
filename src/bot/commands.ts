import { Context, Telegraf } from "telegraf";
import { config } from "../config.js";
import { createLogger } from "../utils/logger.js";
import type { RunStatus } from "../types.js";

const logger = createLogger("commands");

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
  scrape: () => Promise<string>;
  isRunning: () => Promise<boolean>;
  getLastRun: () => RunStatus | undefined;
  getNextRunAt: () => Date | undefined;
};

export function isAuthorizedChat(ctx: Context): boolean {
  const chatId = config.options.notifications?.telegram?.chatId;
  return Boolean(chatId) && ctx.chat?.id?.toString() === chatId;
}

export async function formatStatus(
  handlers: Pick<CommandHandlers, "isRunning" | "getLastRun" | "getNextRunAt">,
): Promise<string> {
  const lines = [
    (await handlers.isRunning())
      ? "🔄 A scrape is running right now"
      : "😴 Idle",
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

export function registerCommands(
  bot: Telegraf<Context>,
  handlers: CommandHandlers,
) {
  bot.catch(async (e, ctx) => {
    logger("Failed to handle an update", e);
    await ctx.reply("❌ Failed to handle the command").catch(() => {});
  });

  bot.use((ctx, next) => {
    if (isAuthorizedChat(ctx)) return next();
    logger(`Ignoring an update from unauthorized chat ${ctx.chat?.id}`);
  });

  bot.command(SCRAPE_COMMANDS, async (ctx) => {
    await ctx.reply(await handlers.scrape());
  });
  bot.command("status", async (ctx) => {
    await ctx.reply(await formatStatus(handlers));
  });
  bot.command("help", (ctx) => ctx.reply(HELP_MESSAGE));

  bot.telegram
    .setMyCommands(BOT_COMMANDS)
    .catch((e) => logger("Failed to set the Telegram command menu", e));
}
