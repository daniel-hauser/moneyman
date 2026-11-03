import { CompanyTypes } from "israeli-bank-scrapers";
import { MoneymanConfigSchema } from "./config.schema.js";
import { getAccounts } from "./config.js";
import { selectionChoices, retryChoices } from "./selection.js";

const accounts = [
  {
    companyId: "hapoalim",
    username: "invented-a",
    password: "invented-pass",
    scrapeId: "home",
  },
  {
    companyId: "hapoalim",
    username: "invented-b",
    password: "invented-pass",
    scrapeId: "shared",
  },
  {
    companyId: "leumi",
    username: "invented-c",
    password: "invented-pass",
    scrapeId: "shared",
  },
  { companyId: "leumi", username: "invented-d", password: "invented-pass" },
];
const snapshot = (scraping = {}) =>
  MoneymanConfigSchema.parse({ accounts, options: { scraping } });

describe("scrape selection", () => {
  it("keeps omitted and legacy empty selection unrestricted", () => {
    expect(getAccounts(snapshot())).toHaveLength(4);
    expect(getAccounts(snapshot({ accountsToScrape: [] }))).toHaveLength(4);
    expect(getAccounts(snapshot({ accountsToScrape: ["leumi"] }))).toHaveLength(
      2,
    );
  });
  it.each(["a".repeat(61), "private label", "שם", "account:home"])(
    "filters, selects and retries arbitrary string aliases: %s",
    (scrapeId) => {
      const config = MoneymanConfigSchema.parse({
        accounts: [{ ...accounts[0], scrapeId }, accounts[3]],
        options: { scraping: { filter: { scrapeIds: [scrapeId] } } },
      });
      expect(getAccounts(config)).toEqual([config.accounts[0]]);
      expect(getAccounts(config, [scrapeId])).toEqual([config.accounts[0]]);
      expect(selectionChoices(getAccounts(config))).toContain(scrapeId);
      const retry = retryChoices(
        [{ companyId: CompanyTypes.hapoalim, scrapeId }],
        selectionChoices(getAccounts(config)),
      );
      expect(getAccounts(config, retry)).toEqual([config.accounts[0]]);
    },
  );
  it("rejects an empty configured scrapeId", () => {
    expect(() =>
      MoneymanConfigSchema.parse({
        accounts: [{ ...accounts[0], scrapeId: "" }],
      }),
    ).toThrow();
  });
  it("allows identical configured logins", () => {
    expect(
      MoneymanConfigSchema.parse({
        accounts: [accounts[0], accounts[0]],
      }).accounts,
    ).toHaveLength(2);
  });
  it("filters by aliases, not companies or credentials", () => {
    expect(
      getAccounts(
        snapshot({
          filter: { scrapeIds: ["shared"] },
        }),
      ),
    ).toEqual([accounts[1], accounts[2]]);
    expect(() =>
      getAccounts(snapshot({ filter: { scrapeIds: ["invented-a"] } })),
    ).toThrow("Unknown");
  });
  it.each([
    { filter: { scrapeIds: [] } },
    { filter: { scrapeIds: ["unknown"] } },
    { filter: {}, accountsToScrape: [] },
  ])("rejects invalid or ambiguous configured scopes: %j", (scraping) => {
    expect(() => getAccounts(snapshot(scraping))).toThrow();
  });
  it("preserves legacy unknown-company selection without falling back to all accounts", () => {
    expect(getAccounts(snapshot({ accountsToScrape: ["unknown"] }))).toEqual(
      [],
    );
  });
  it("allows company IDs beyond Telegram callback constraints", () => {
    const companyId = "שם חברה : " + "x".repeat(100);
    const config = MoneymanConfigSchema.parse({
      accounts: [{ ...accounts[0], companyId }],
      options: { scraping: { accountsToScrape: [companyId] } },
    });
    expect(getAccounts(config)).toEqual(config.accounts);
  });
  it("allows duplicates and selects every allowed alias match", () => {
    expect(getAccounts(snapshot(), ["shared"])).toEqual([
      accounts[1],
      accounts[2],
    ]);
    expect(
      getAccounts(snapshot({ accountsToScrape: ["hapoalim"] }), ["shared"]),
    ).toEqual([accounts[1]]);
  });
  it("rejects empty, removed or excluded runtime selections without mutating scope", () => {
    const config = snapshot({ filter: { scrapeIds: ["home"] } });
    expect(getAccounts(config, [])).toEqual([]);
    expect(getAccounts(config, ["shared"])).toEqual([]);
    expect(getAccounts(config, ["removed"])).toEqual([]);
    expect(getAccounts(snapshot(), ["home", "removed"])).toEqual([]);
    expect(config.accounts).toHaveLength(4);
  });
  it("shows only distinct allowed aliases and omits unnamed logins", () => {
    const choices = selectionChoices(
      getAccounts(snapshot({ filter: { scrapeIds: ["shared"] } })),
    );
    expect(choices).toEqual(["shared"]);
    expect(selectionChoices(getAccounts(snapshot()))).toEqual([
      "home",
      "shared",
    ]);
    expect(JSON.stringify(choices)).not.toContain("invented");
  });
  it("does not retry without completed history or eligible IDs", () => {
    expect(
      retryChoices(undefined, selectionChoices(getAccounts(snapshot()))),
    ).toEqual([]);
    expect(retryChoices([], selectionChoices(getAccounts(snapshot())))).toEqual(
      [],
    );
    expect(
      retryChoices(
        [{ companyId: CompanyTypes.leumi }],
        selectionChoices(getAccounts(snapshot())),
      ),
    ).toEqual([]);
  });
  it("retries all duplicate alias matches and skips unavailable or unnamed failures", () => {
    const retry = retryChoices(
      [
        { companyId: CompanyTypes.hapoalim, scrapeId: "shared" },
        { companyId: CompanyTypes.leumi, scrapeId: "removed" },
        { companyId: CompanyTypes.leumi },
      ],
      selectionChoices(getAccounts(snapshot())),
    );
    expect(retry).toEqual(["shared"]);
    expect(getAccounts(snapshot(), retry)).toEqual([accounts[1], accounts[2]]);
  });
});
