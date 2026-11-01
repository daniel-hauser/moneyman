import { CompanyTypes } from "israeli-bank-scrapers";
import { accountId, accountLabel } from "./accountLabel.js";
import type { AccountConfig } from "../types.js";

const account = (fields: Record<string, unknown>) =>
  ({
    companyId: CompanyTypes.isracard,
    password: "super-secret-password",
    ...fields,
  }) as unknown as AccountConfig;

describe("accountLabel", () => {
  it.each([
    ["card6Digits", "123456", "isracard · ••3456"],
    ["num", "9876543210", "isracard · ••3210"],
    ["userCode", "12345", "isracard · ••2345"],
    ["nationalID", "012345678", "isracard · ••5678"],
    ["id", "012345678", "isracard · ••5678"],
    ["username", "noamokman", "isracard · n••••••••"],
    ["email", "noam@gmail.com", "isracard · n•••@gmail.com"],
  ])("masks %s", (_field, value, expected) => {
    expect(accountLabel(account({ [_field as string]: value }))).toBe(expected);
  });

  it("prefers the most specific identity field", () => {
    expect(
      accountLabel(
        account({
          id: "012345678",
          card6Digits: "999888",
          username: "someone",
        }),
      ),
    ).toBe("isracard · ••9888");
  });

  it("never exposes the password", () => {
    const label = accountLabel(
      account({ username: "noamokman", password: "super-secret-password" }),
    );

    expect(label).not.toContain("secret");
    expect(accountId(account({ username: "noamokman" }))).not.toContain(
      "secret",
    );
  });

  it("falls back to the provider when nothing identifies the account", () => {
    expect(accountLabel(account({}))).toBe("isracard");
  });

  it("tells two accounts of one provider apart", () => {
    const labels = [
      account({ card6Digits: "123456" }),
      account({ card6Digits: "654321" }),
    ].map(accountLabel);

    expect(new Set(labels).size).toBe(2);
  });

  it("gives the same account the same id, and different accounts different ids", () => {
    const id = accountId(account({ card6Digits: "123456" }));
    expect(accountId(account({ card6Digits: "123456" }))).toBe(id);
    expect(accountId(account({ card6Digits: "654321" }))).not.toBe(id);
    expect(
      accountId(account({ card6Digits: "123456", password: "other" })),
    ).toBe(id);
  });

  it("does not depend on the password, so identical non-secret fields share an id", () => {
    // The password is the only thing left to tell these two apart, and it must
    // not be encoded: they are selected together rather than leaking it.
    expect(accountId(account({ card6Digits: "123456" }))).toBe(
      accountId(
        account({ card6Digits: "123456", password: "a-different-one" }),
      ),
    );
  });
});
