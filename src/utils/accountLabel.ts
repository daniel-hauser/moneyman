import { createHash } from "node:crypto";
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
 * A stable id for a configured account, derived from its provider and every
 * non-secret login field, so two accounts of one provider that differ in any
 * of them stay distinct. It survives a config reload (long running mode
 * refreshes accounts between runs) and is what a scrape selection carries, so
 * a picker tap cannot be resolved to the wrong account when positions shift.
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
    .update(`${account.companyId}\u0000${identity}`)
    .digest("hex")
    .slice(0, 12);
}
