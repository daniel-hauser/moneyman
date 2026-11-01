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
  /** Stable id of the account's non-secret login fields */
  id: string;
  /** Masked label, e.g. `isracard · ••3456` */
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
 * Masks are lossy — `noam` and `nora` both mask to `n•••`, and two accounts of
 * one provider can also share a card BIN — so two accounts with different ids
 * can still render the same label. Append a short, id-derived suffix to the
 * labels that read alike, so every button stays unambiguous; the ids behind
 * them are already distinct, which is what makes a suffix enough.
 *
 * Deterministic: the same accounts always produce the same labels.
 */
export function disambiguateLabels(
  choices: Array<AccountChoice>,
): Array<AccountChoice> {
  const counts = new Map<string, number>();
  for (const { label } of choices) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const taken = new Set(choices.map(({ label }) => label));

  return choices.map((choice) => {
    if ((counts.get(choice.label) ?? 0) < 2) return choice;
    for (const length of [4, 8, 12] as const) {
      const label = `${choice.label} #${choice.id.slice(0, length)}`;
      // A suffixed label must not collide with an existing or earlier one
      if (!taken.has(label)) {
        taken.add(label);
        return { ...choice, label };
      }
    }
    return choice;
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
      inline_keyboard: disambiguateLabels(choices).map(
        ({ id, label, failedLastRun }) => [
          {
            text: `${failedLastRun ? "❌" : "▶️"} ${label}`,
            callback_data: `${ACCOUNT_CALLBACK_PREFIX}${id}`,
          },
        ],
      ),
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
      const choice = disambiguateLabels(await listAccounts()).find(
        (choice) => choice.id === id,
      );
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
