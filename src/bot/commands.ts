import { Context, Telegraf } from "telegraf";
import { createLogger } from "../utils/logger.js";
import type { RunStatus } from "../types.js";

const logger = createLogger("commands");

export const SCRAPE_COMMANDS = ["scrape", "fetch"];

/**
 * Opens the per-account picker. Registered separately from SCRAPE_COMMANDS so
 * `/scrape` keeps scraping every account.
 */
export const SCRAPE_ACCOUNT_COMMAND = "scrape_provider";

const ACCOUNT_CALLBACK_PREFIX = `${SCRAPE_ACCOUNT_COMMAND}:`;
const ACCOUNT_CALLBACK_PATTERN = new RegExp(`^${ACCOUNT_CALLBACK_PREFIX}(.+)$`);

/** A configured account the user can pick from */
export interface AccountChoice {
  /** Opaque id of the account's non-secret login fields */
  id: string;
  /** Masked, ready-to-show label, e.g. `isracard · •••111 · n••• #4f2a` */
  label: string;
  /** Whether this account failed in the last finished run */
  failedLastRun: boolean;
}

export type CommandHandlers = {
  /** Scrape every account, or only the ones with these account ids */
  scrape: (accountIds?: readonly string[]) => Promise<string>;
  refreshSecrets?: () => Promise<string>;
  isRunning: () => Promise<boolean>;
  getLastRun: () => RunStatus | undefined;
  getNextRunAt: () => Date | undefined;
  /**
   * The accounts offered by `/scrape_provider`. The command is registered,
   * listed in the menu and in `/help` only when this is set.
   */
  listAccounts?: () => Promise<AccountChoice[]>;
};

/**
 * The `/status` reply: what the process is doing, how the last run ended —
 * naming the accounts that failed it, so a re-scrape of the right one needs no
 * digging into the report — and when the next scheduled run is due. Labels come
 * from `listAccounts`, the same ones the picker shows.
 */
export async function formatStatus(
  handlers: Pick<
    CommandHandlers,
    "isRunning" | "getLastRun" | "getNextRunAt"
  > & {
    /** Account labels, when available: without them failures stay unnamed */
    listAccounts?: CommandHandlers["listAccounts"];
  },
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

    const failedIds = lastRun.failedAccountIds ?? [];
    if (lastRun.failed && failedIds.length) {
      const choices = await handlers.listAccounts?.();
      if (!choices) {
        lines.push(`\tFailed: ${failedIds.length} account(s)`);
      } else {
        // An account that failed but is no longer configured has no label left
        const gone = failedIds.filter(
          (id) => !choices.some((choice) => choice.id === id),
        ).length;
        lines.push(
          `\tFailed: ${[
            ...choices
              .filter(({ failedLastRun }) => failedLastRun)
              .map(({ label }) => label),
            ...(gone > 0 ? [`${gone} no longer configured`] : []),
          ].join(", ")}`,
        );
      }
    }
  } else {
    lines.push("No run finished in this process yet");
  }

  const nextRunAt = handlers.getNextRunAt();
  lines.push(
    nextRunAt
      ? `⏰ Next scheduled run at ${formatDate(nextRunAt)}`
      : `⏰ No scheduled run configured, only manual runs`,
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
 * The picker message. ❌ marks the accounts that failed in the last run, which
 * is usually the one the user wants to scrape again.
 */
export function formatAccountPicker(choices: Array<AccountChoice>): {
  text: string;
  reply_markup: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
} {
  const failed = choices.filter(({ failedLastRun }) => failedLastRun).length;
  const lines = [
    "Pick a provider/account to scrape:",
    "",
    ...(failed
      ? [`❌ marked the ${failed} account(s) that failed in the last run.`]
      : ["Every configured account is listed."]),
  ];

  return {
    text: lines.join("\n"),
    reply_markup: {
      // Labels arrive ready to show: the caller builds them from the configured
      // accounts (see `accountLabels`), suffixes included.
      inline_keyboard: choices.map(({ id, label, failedLastRun }) => [
        {
          text: `${failedLastRun ? "❌" : "▶️"} ${label}`,
          callback_data: `${ACCOUNT_CALLBACK_PREFIX}${id}`,
        },
      ]),
    },
  };
}

/** Telegram keeps an inline keyboard until it is replaced with an empty one */
const REMOVE_KEYBOARD = { inline_keyboard: [] as Array<never> };

export function registerCommands(
  bot: Telegraf<Context>,
  handlers: CommandHandlers,
) {
  const refreshSecrets = handlers.refreshSecrets;
  const listAccounts = handlers.listAccounts;
  const commands = [
    { command: SCRAPE_COMMANDS[0], description: "Run a scrape now" },
    listAccounts
      ? {
          command: SCRAPE_ACCOUNT_COMMAND,
          description: "Scrape a single provider/account only",
        }
      : undefined,
    refreshSecrets
      ? {
          command: "refresh_secrets",
          description: "Fetch and validate provider secrets without scraping",
        }
      : undefined,
    { command: "status", description: "Show the last run and the next one" },
    { command: "help", description: "List the available commands" },
  ].filter((command) => command !== undefined);
  const help = [
    "Moneyman is running and listening for commands:",
    "",
    ...commands.map(
      ({ command, description }) => `/${command} — ${description}`,
    ),
  ].join("\n");

  bot.catch(async (e, ctx) => {
    logger("Failed to handle an update", e);
    await ctx.reply("❌ Failed to handle the command").catch(() => {});
  });

  bot.command(SCRAPE_COMMANDS, async (ctx) => {
    await ctx.reply(await handlers.scrape());
  });
  bot.command("status", async (ctx) => {
    await ctx.reply(await formatStatus(handlers));
  });
  if (refreshSecrets) {
    bot.command("refresh_secrets", async (ctx) => {
      await ctx.reply(await refreshSecrets());
    });
  }
  if (listAccounts) {
    bot.command(SCRAPE_ACCOUNT_COMMAND, async (ctx) => {
      const choices = await listAccounts();
      if (!choices.length) {
        await ctx.reply("No accounts are configured to scrape.");
        return;
      }
      const { text, reply_markup } = formatAccountPicker(choices);
      await ctx.reply(text, { reply_markup });
    });

    bot.action(ACCOUNT_CALLBACK_PATTERN, async (ctx) => {
      // The keyboard is single use: it is replaced by this tap's outcome, so a
      // second tap on a stale message cannot start another run.
      await ctx
        .answerCbQuery()
        .catch((e) =>
          logger("Failed to answer the account picker callback", e),
        );

      const id = ctx.match[1];
      // Same labels as the keyboard the tap came from, so the edited message
      // names the account the button named.
      const choice = (await listAccounts()).find((choice) => choice.id === id);
      if (!choice) {
        await ctx
          .editMessageText(
            "❌ That account is no longer configured. Run /scrape_provider again.",
            { reply_markup: REMOVE_KEYBOARD },
          )
          .catch((e) => logger("Failed to update the account picker", e));
        return;
      }

      const outcome = await handlers.scrape([id]);
      await ctx
        .editMessageText(`▶️ ${choice.label}\n${outcome}`, {
          reply_markup: REMOVE_KEYBOARD,
        })
        .catch((e) => logger("Failed to update the account picker", e));
    });
  }
  bot.command("help", (ctx) => ctx.reply(help));

  bot.telegram
    .setMyCommands(commands)
    .catch((e) => logger("Failed to set the Telegram command menu", e));
}
