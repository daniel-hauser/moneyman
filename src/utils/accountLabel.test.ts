import { CompanyTypes } from "israeli-bank-scrapers";
import { accountId, accountLabel, accountLabels } from "./accountLabel.js";
import type { AccountConfig } from "../types.js";

const account = (fields: Record<string, unknown>) =>
  ({
    companyId: CompanyTypes.isracard,
    password: "super-secret-password",
    ...fields,
  }) as unknown as AccountConfig;

describe("accountLabel", () => {
  it.each([
    ["card6Digits", "123456", "isracard · •••456"],
    ["num", "9876543210", "isracard · ••••••3210"],
    ["userCode", "12345", "isracard · •••45"],
    ["nationalID", "012345678", "isracard · •••••5678"],
    ["id", "012345678", "isracard · •••••5678"],
    ["username", "noamokman", "isracard · n••••••••"],
    ["email", "noam@gmail.com", "isracard · n•••@gmail.com"],
  ])("masks %s", (_field, value, expected) => {
    expect(accountLabel(account({ [_field as string]: value }))).toBe(expected);
  });

  it("shows every populated identity field, most specific first", () => {
    expect(
      accountLabel(
        account({
          id: "012345678",
          card6Digits: "999888",
          username: "someone",
        }),
      ),
    ).toBe("isracard · •••888 · •••••5678 · s••••••");

    // A single field stays a single mask
    expect(accountLabel(account({ card6Digits: "999888" }))).toBe(
      "isracard · •••888",
    );
  });

  it("labels accounts that differ by any field differently", () => {
    const accounts = [
      account({ card6Digits: "111111", id: "012345678" }),
      account({ card6Digits: "111111", username: "noam" }),
      account({ card6Digits: "222222", id: "012345678" }),
      account({ username: "noam" }),
    ];

    expect(new Set(accounts.map(accountLabel)).size).toBe(accounts.length);
    expect(new Set(accounts.map(accountId)).size).toBe(accounts.length);
  });

  it("can mask two different accounts to the same label", () => {
    // Masking is lossy, so the label alone cannot promise uniqueness: the
    // picker disambiguates colliding labels with an id-derived suffix.
    const noam = account({ card6Digits: "111111", username: "noam" });
    const nora = account({ card6Digits: "111111", username: "nora" });

    expect(accountLabel(noam)).toBe(accountLabel(nora));
    expect(accountId(noam)).not.toBe(accountId(nora));
  });

  it.each([["a"], ["ab"], ["abc"], ["user"], ["1234"], ["12345"]])(
    "never shows a short identifier in full (%s)",
    (value) => {
      const [, masked] = accountLabel(account({ userCode: value })).split(
        " · ",
      );

      expect(masked).not.toContain(value);
      expect(masked).toContain("•");
    },
  );

  describe("accountLabels", () => {
    it("keys labels by account id", () => {
      const first = account({ card6Digits: "111111" });
      const labels = accountLabels([first, account({ card6Digits: "222222" })]);

      expect(labels.size).toBe(2);
      expect(labels.get(accountId(first))).toBe("isracard · •••111");
    });

    it("collapses accounts that are identical in every non-secret field", () => {
      const labels = accountLabels([
        account({ card6Digits: "111111" }),
        account({ card6Digits: "111111", password: "a-different-one" }),
      ]);

      expect(labels.size).toBe(1);
    });

    it("suffixes only the labels that read alike", () => {
      const colliding = account({ card6Digits: "111111" });
      const sameMask = account({ card6Digits: "222111" });
      const other = account({ card6Digits: "999999" });

      const labels = accountLabels([colliding, sameMask, other]);

      // The collision is real, and only these two carry a suffix
      expect(accountLabel(colliding)).toBe(accountLabel(sameMask));
      expect(labels.get(accountId(other))).toBe("isracard · •••999");
      for (const one of [colliding, sameMask]) {
        expect(labels.get(accountId(one))).toBe(
          `isracard · •••111 #${accountId(one).slice(0, 4)}`,
        );
      }
    });

    it("labels a whole set uniquely whenever the ids are unique", () => {
      const accounts = [
        account({ card6Digits: "111111", id: "012345678" }),
        account({ card6Digits: "222111", id: "012345678" }),
        account({ card6Digits: "111111", username: "noam" }),
        account({ username: "noam" }),
      ];
      const labels = accountLabels(accounts);

      expect(labels.size).toBe(accounts.length);
      expect(new Set(labels.values()).size).toBe(accounts.length);
    });
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

  it("keeps accounts apart that differ in a field other than the first one", () => {
    // A second card of the same issuer can share card6Digits and still differ
    // by another login field: sharing an id would hide it from the picker and
    // scrape both.
    const shared = { card6Digits: "123456" };
    expect(accountId(account({ ...shared, username: "noam" }))).not.toBe(
      accountId(account({ ...shared, username: "dana" })),
    );
    expect(accountId(account({ ...shared, email: "a@b.com" }))).not.toBe(
      accountId(account({ ...shared, email: "c@d.com" })),
    );
    expect(accountId(account({ card6Digits: "123456", id: "111" }))).not.toBe(
      accountId(account({ card6Digits: "123456", id: "222" })),
    );
  });

  it("orders the identity fields the same way whatever the config order", () => {
    // Object key order must not change an account's identity
    expect(
      accountId(account({ card6Digits: "123456", username: "noam" })),
    ).toBe(accountId(account({ username: "noam", card6Digits: "123456" })));
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
