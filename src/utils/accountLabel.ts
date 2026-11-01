import { createHash, randomBytes } from "node:crypto";
import type { AccountConfig } from "../types.js";

/**
 * The non-secret login fields that identify an account within a provider, most
 * specific first. `password` is deliberately absent: an account label and an
 * account id both end up in Telegram messages and in the run report, and a
 * password must never reach either.
 */
const IDENTITY_FIELDS = [
  "card6Digits",
  "num",
  "userCode",
  "nationalID",
  "id",
  "username",
  "email",
] as const;

type IdentityField = (typeof IDENTITY_FIELDS)[number];

/** Every populated non-secret login field, in a stable order */
function identityFields(
  account: AccountConfig,
): Array<{ field: IdentityField; value: string }> {
  const fields = account as Record<string, unknown>;
  return IDENTITY_FIELDS.flatMap((field) => {
    const value = fields[field];
    return typeof value === "string" && value.trim()
      ? [{ field, value: value.trim() }]
      : [];
  });
}

/** Keep the first character, hide the rest — and hide a one-character value too */
function maskAllButFirst(value: string): string {
  if (value.length < 2) return "•".repeat(Math.max(2, value.length + 1));
  return `${value.slice(0, 1)}${"•".repeat(Math.max(2, value.length - 1))}`;
}

/**
 * Keep the last characters of an identifier, never more than half of it. A
 * fixed four-character tail would print a four-character code in full
 * (`userCode: "user"` → `user`), and every field now reaches a Telegram label.
 */
function maskIdentifier(value: string): string {
  const visible = Math.min(4, Math.floor(value.length / 2));
  return `${"•".repeat(Math.max(2, value.length - visible))}${
    visible ? value.slice(-visible) : ""
  }`;
}

/**
 * Mask a login value, keeping enough of it to tell two accounts of the same
 * provider apart: card and bank identifiers keep their last few digits (the
 * convention for card numbers), while usernames and emails keep their first
 * character only. No value is ever shown in full.
 */
function maskValue(field: IdentityField, value: string): string {
  if (field === "username") return maskAllButFirst(value);

  if (field === "email") {
    const [local, domain] = value.split("@");
    if (!local || !domain) return maskAllButFirst(value);
    return `${maskAllButFirst(local)}@${domain}`;
  }

  return maskIdentifier(value);
}

/**
 * A short, human-readable label for a configured account, e.g.
 * `isracard · •••111 · •••••5678`. Used by the `/scrape_provider` picker, by the
 * run summary and by the HTML report, so a failure names the account instead
 * of only its provider.
 *
 * Every populated non-secret login field is shown, masked, most specific
 * first. Masking is lossy, so two accounts that differ in a masked field can
 * still produce the same label — the `/scrape_provider` picker disambiguates
 * those labels (see `disambiguateLabels`), and the run summary and report are
 * keyed by `accountId()`.
 *
 * Falls back to the bare provider name when the account has no usable
 * identity field.
 */
export function accountLabel(account: AccountConfig): string {
  const identity = identityFields(account);
  return identity.length
    ? [
        account.companyId,
        ...identity.map(({ field, value }) => maskValue(field, value)),
      ].join(" · ")
    : account.companyId;
}

/**
 * Key for the account id: random per process and never transmitted.
 *
 * The id travels in Telegram callback data next to a masked label, and several
 * identity fields are short and low entropy (a six-digit card prefix, a four
 * digit code), so an unkeyed digest of them can be enumerated offline to
 * recover what the label hides. A process-lifetime key keeps the id stable for
 * as long as it is needed — a keyboard sent earlier in the same process still
 * resolves after a config reload — without a reusable digest, and it needs no
 * configuration or key management. After a restart an old keyboard resolves to
 * nothing and is refused, which starts no run.
 */
const ACCOUNT_ID_KEY = randomBytes(32);

/**
 * Labels for a set of configured accounts, keyed by account id, computed once
 * so a picker button, a run filtered to one account and a full run all name an
 * account the same way.
 *
 * Labels that read alike — masking is lossy — get a short, id-derived suffix,
 * and only those. The ids behind them are distinct, which is what makes a
 * suffix enough; a suffix that would collide with a label already in use falls
 * back to a longer id prefix.
 */
export function accountLabels(
  accounts: readonly AccountConfig[],
): Map<string, string> {
  const base = new Map<string, string>();
  for (const account of accounts) {
    const id = accountId(account);
    if (!base.has(id)) base.set(id, accountLabel(account));
  }

  const counts = new Map<string, number>();
  for (const label of base.values()) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const taken = new Set(base.values());
  const labels = new Map<string, string>();
  for (const [id, label] of base) {
    let chosen = label;
    if ((counts.get(label) ?? 0) > 1) {
      for (const length of [4, 8, 12] as const) {
        const candidate = `${label} #${id.slice(0, length)}`;
        if (!taken.has(candidate)) {
          chosen = candidate;
          break;
        }
      }
    }
    taken.add(chosen);
    labels.set(id, chosen);
  }
  return labels;
}

/**
 * A stable id for a configured account, derived from its provider and every
 * non-secret login field, so two accounts of one provider that differ in any
 * of them stay distinct. It is what a scrape selection carries, so a picker tap
 * cannot be resolved to the wrong account when positions shift.
 *
 * Accounts that are identical in every non-secret login field share an id and
 * are therefore selected together — the only thing left to tell them apart is
 * the password, which must not be encoded here.
 */
export function accountId(account: AccountConfig): string {
  const identity = identityFields(account)
    .map(({ field, value }) => `${field}=${value}`)
    .join("\u0000");
  return createHash("sha256")
    .update(ACCOUNT_ID_KEY)
    .update(`${account.companyId}\u0000${identity}`)
    .digest("hex")
    .slice(0, 12);
}
