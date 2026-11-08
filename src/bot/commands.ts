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
/**
 * A picker's buttons carry the moment they stop being usable, so a keyboard
 * that outlives this process's bookkeeping still refuses the tap. The expiry is
 * optional in the pattern: a picker sent before the buttons carried one has
 * none, and is treated as expired.
 */
const ACCOUNT_CALLBACK_PATTERN = new RegExp(
  `^${ACCOUNT_CALLBACK_PREFIX}(?:(\\d+):)?(.+)$`,
);
/** How long a picker stays tappable - and so how long its claim has to hold */
export const PICKER_TTL_MS = 24 * 60 * 60 * 1000;
const EXPIRED_PICKER_MESSAGE =
  "⌛️ This picker has expired. Run /scrape_provider again.";

/** `scrape_provider:<expires at>:<account id>`, the expiry in epoch millis */
export function pickerCallbackData(id: string, expiresAt: number): string {
  return `${ACCOUNT_CALLBACK_PREFIX}${expiresAt}:${id}`;
}

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
        // Labels come from the ids this reply describes rather than from the
        // choices' failure marks: rebuilding the choices spans a provider
        // refresh, so a run finishing in between would relabel this reply with
        // the newer run's failures.
        const labelled = choices
          .filter(({ id }) => failedIds.includes(id))
          .map(({ label }) => label);
        // An account that failed but is no longer configured has no label left
        const gone = failedIds.filter(
          (id) => !choices.some((choice) => choice.id === id),
        ).length;
        lines.push(
          `\tFailed: ${[
            ...labelled,
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
export function formatAccountPicker(
  choices: Array<AccountChoice>,
  now = Date.now(),
): {
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
          callback_data: pickerCallbackData(id, now + PICKER_TTL_MS),
        },
      ]),
    },
  };
}

/** Telegram keeps an inline keyboard until it is replaced with an empty one */
const REMOVE_KEYBOARD = { inline_keyboard: [] as Array<never> };

/**
 * Pickers that were already tapped, by `chatId:messageId`.
 *
 * The keyboard is single use, but the message edit that removes it is best
 * effort: it can fail, and then a keyboard that still works would start another
 * scrape. The claim, recorded before anything is awaited, is what actually
 * makes a picker single use — a second tap on the same message does nothing.
 * Bounded, so a long running bot cannot pile them up: the oldest claim is
 * dropped first, which is a picker nobody is going to tap again.
 */
const claimedPickers = new Set<string>();
const MAX_CLAIMED_PICKERS = 100;

/**
 * Claims whose keyboard is still attached to the message, because the edit that
 * removes it is still in flight or failed. The cap above only bounds pickers
 * that can no longer be tapped, so these are held past it: a tap after the first
 * run released the scrape lock would start a second one. Each entry is dropped
 * once its own picker expires, so this cannot grow without bound either.
 */
const liveKeyboards = new Map<string, number>();

/** Identifies a picker by the message that carries its keyboard */
function pickerKey(ctx: Context): string {
  return `${ctx.chat?.id}:${ctx.callbackQuery?.message?.message_id}`;
}

/**
 * Claim a picker, so a second tap on it cannot start a second scrape.
 *
 * Live claims are held until the picker's own buttons expire, which is safe
 * because an expired picker refuses its taps without any bookkeeping - and that
 * is what stops the map growing for the life of a long-running bot.
 */
function claimPicker(ctx: Context, expiresAt: number): boolean {
  const key = pickerKey(ctx);
  const now = Date.now();
  for (const [claimed, expires] of liveKeyboards) {
    if (now > expires) liveKeyboards.delete(claimed);
  }
  if (claimedPickers.has(key) || liveKeyboards.has(key)) return false;
  // Claimed into the live set, not the capped one: until the outcome edit
  // settles, the keyboard can still deliver a tap
  liveKeyboards.set(key, expiresAt);
  return true;
}

/** The keyboard is gone, so the claim only has to refuse a replayed callback */
function retirePicker(ctx: Context): void {
  const key = pickerKey(ctx);
  liveKeyboards.delete(key);
  claimedPickers.add(key);
  if (claimedPickers.size > MAX_CLAIMED_PICKERS) {
    const oldest = claimedPickers.values().next().value;
    if (oldest !== undefined) claimedPickers.delete(oldest);
  }
}

/** Replace the picker with its outcome; a failed edit keeps the claim live */
async function showPickerOutcome(ctx: Context, text: string): Promise<void> {
  await ctx
    .editMessageText(text, { reply_markup: REMOVE_KEYBOARD })
    .then(() => retirePicker(ctx))
    .catch((e) => logger("Failed to update the account picker", e));
}

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
      // A picker from before its buttons carried an expiry, or one whose
      // buttons have outlived it: neither may start a run
      const expiresAt = ctx.match[1] ? Number(ctx.match[1]) : 0;
      const expired = Date.now() > expiresAt;
      // Claimed before the first await: a second tap on the same picker must
      // not start a second scrape, whether or not the edits below succeed.
      const claimed = !expired && claimPicker(ctx, expiresAt);
      await ctx
        .answerCbQuery()
        .catch((e) =>
          logger("Failed to answer the account picker callback", e),
        );
      if (expired) {
        logger("Ignoring a tap on an account picker that has expired");
        await showPickerOutcome(ctx, EXPIRED_PICKER_MESSAGE);
        return;
      }
      if (!claimed) {
        logger("Ignoring a second tap on the same account picker");
        return;
      }

      const id = ctx.match[2];
      try {
        // Same labels as the keyboard the tap came from, so the edited message
        // names the account the button named.
        const choice = (await listAccounts()).find(
          (choice) => choice.id === id,
        );
        if (!choice) {
          await showPickerOutcome(
            ctx,
            "❌ That account is no longer configured. Run /scrape_provider again.",
          );
          return;
        }

        const outcome = await handlers.scrape([id]);
        await showPickerOutcome(ctx, `▶️ ${choice.label}\n${outcome}`);
      } catch (e) {
        // The keyboard is still attached and its claim refuses a second tap, so
        // the message itself has to tell the user how to try again
        logger("Failed to run the account picker", e);
        await showPickerOutcome(
          ctx,
          "❌ Could not start that scrape. Run /scrape_provider again.",
        );
      }
    });
  }
  bot.command("help", (ctx) => ctx.reply(help));

  bot.telegram
    .setMyCommands(commands)
    .catch((e) => logger("Failed to set the Telegram command menu", e));
}
