import { locks } from "node:worker_threads";
import { Context, Markup, Telegraf } from "telegraf";
import { createLogger } from "../utils/logger.js";
import { sha256 } from "../utils/utils.js";
import type { RunStatus } from "../types.js";
import type { ScrapeSelection } from "../selection.js";

const logger = createLogger("commands");

export const SCRAPE_COMMANDS = ["scrape", "fetch"];

export type CommandAvailability = {
  scrapeIds: string[];
  scrapeFailed: boolean;
};

export type CommandHandlers = {
  scrape: (selection?: ScrapeSelection) => Promise<string>;
  getCommandAvailability?: () => Promise<CommandAvailability>;
  refreshSecrets?: () => Promise<string>;
  isRunning: () => Promise<boolean>;
  getLastRun: () => RunStatus | undefined;
  getNextRunAt: () => Date | undefined;
};

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
  {
    stateChanges,
    signal,
    chatId,
  }: { stateChanges: EventTarget; signal: AbortSignal; chatId?: string },
) {
  const refreshSecrets = handlers.refreshSecrets;
  let selections = new Map<string, string>();
  let availability: CommandAvailability | undefined;
  const scrapeCommand = {
    command: SCRAPE_COMMANDS,
    description: "Scrape now",
    handler: async (ctx: Context, scrapeId?: string) => {
      await ctx.reply(
        await handlers.scrape(
          scrapeId === undefined ? undefined : { choices: [scrapeId] },
        ),
      );
    },
  };
  const commands: {
    command: string | string[];
    description: string;
    disabled?: () => boolean;
    handler: (ctx: Context, scrapeId?: string) => Promise<unknown>;
    refresh?: true;
  }[] = [
    scrapeCommand,
    {
      command: "scrape_accounts",
      description: "Choose an account",
      disabled: () => !selections.size,
      handler: (ctx) =>
        ctx.reply(
          "Choose a login to scrape now:",
          Markup.inlineKeyboard(
            [...selections].map(([hash, choice]) => [
              Markup.button.callback(choice, `sa:${hash}`),
            ]),
          ),
        ),
    },
    {
      command: "scrape_failed",
      description: "Retry failed accounts",
      disabled: () => !availability?.scrapeFailed,
      handler: async (ctx) => {
        await ctx.reply(await handlers.scrape({ retryFailed: true }));
      },
    },
    {
      command: "refresh_secrets",
      description: "Refresh secrets",
      disabled: () => !refreshSecrets,
      refresh: true,
      handler: async (ctx) => {
        if (refreshSecrets) await ctx.reply(await refreshSecrets());
      },
    },
    {
      command: "status",
      description: "Run status",
      handler: async (ctx) => {
        await ctx.reply(await formatStatus(handlers));
      },
    },
  ];
  // Serialized so an older configuration cannot replace a newer one.
  const refreshMenu = () => locks.request("moneyman-command-menu", publishMenu);
  async function publishMenu() {
    if (signal.aborted || !chatId) return;
    try {
      const available = await handlers.getCommandAvailability?.();
      if (signal.aborted) return;
      availability = available;
      if (available) {
        selections = new Map(
          available.scrapeIds.map((id) => [sha256(id, "base64url"), id]),
        );
      }
      const menu = commands
        .filter(({ disabled }) => !disabled?.())
        .map(({ command, description }) => ({
          command: Array.isArray(command) ? command[0] : command,
          description,
        }));
      await bot.telegram.setMyCommands(menu, {
        scope: { type: "chat", chat_id: chatId },
      });
    } catch (error) {
      logger("Failed to refresh the Telegram command menu", error);
    }
  }
  async function executeCommand(
    command: (typeof commands)[number],
    ctx: Context,
    scrapeId?: string,
  ) {
    if (ctx.callbackQuery) await ctx.answerCbQuery();
    if (command.disabled?.())
      return ctx.reply("This command is currently unavailable.");
    try {
      return await command.handler(ctx, scrapeId);
    } finally {
      if (command.refresh) await refreshMenu();
    }
  }

  bot.catch(async (e, ctx) => {
    logger("Failed to handle an update", e);
    await ctx.reply("❌ Failed to handle the command").catch(() => {});
  });

  for (const command of commands) {
    bot.command(command.command, (ctx) =>
      executeCommand(command, ctx, ctx.payload || undefined),
    );
  }
  bot.action(/^sa:(.*)$/s, async (ctx) => {
    const choice = selections.get(ctx.match[1]);
    if (choice !== undefined) return executeCommand(scrapeCommand, ctx, choice);
    try {
      await ctx.answerCbQuery();
      return await ctx.reply(
        "Selection is no longer available. Open /scrape_accounts again.",
      );
    } finally {
      await refreshMenu();
    }
  });
  stateChanges.addEventListener("stateChanged", () => void refreshMenu(), {
    signal,
  });
  void refreshMenu();
}
