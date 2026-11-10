import { CompanyTypes } from "israeli-bank-scrapers";
import { MoneymanConfigSchema } from "./config.schema.js";
import { getAccounts } from "./config.js";
import { selectionChoices, retryChoices } from "./selection.js";
import { sendDeprecationMessage } from "./bot/deprecationManager.js";

jest.mock("./bot/deprecationManager.js", () => ({
  sendDeprecationMessage: jest.fn(),
}));

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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps omitted and legacy empty selection unrestricted", () => {
    expect(getAccounts(snapshot())).toHaveLength(4);
    expect(getAccounts(snapshot({ accountsToScrape: [] }))).toHaveLength(4);
    expect(sendDeprecationMessage).not.toHaveBeenCalled();
  });
  it("keeps company-name fallback and requests the standard deprecation warning", () => {
    const config = snapshot({ accountsToScrape: ["leumi"] });
    expect(getAccounts(config)).toEqual([accounts[2], accounts[3]]);
    expect(sendDeprecationMessage).toHaveBeenCalledWith(
      "accountsToScrapeCompanyId",
      [],
    );
  });
  it("passes the current snapshot's hidden deprecations to the warning manager", () => {
    getAccounts(
      snapshot({
        accountsToScrape: ["hapoalim"],
        hiddenDeprecations: ["accountsToScrapeCompanyId"],
      }),
    );
    expect(sendDeprecationMessage).toHaveBeenCalledWith(
      "accountsToScrapeCompanyId",
      ["accountsToScrapeCompanyId"],
    );
  });
  it.each(["a", "a".repeat(61), "private label", "שם", "account:home"])(
    "filters, selects and retries arbitrary string aliases: %s",
    (scrapeId) => {
      const config = MoneymanConfigSchema.parse({
        accounts: [{ ...accounts[0], scrapeId }, accounts[3]],
        options: { scraping: { accountsToScrape: [scrapeId] } },
      });
      expect(getAccounts(config)).toEqual([config.accounts[0]]);
      expect(getAccounts(config, [scrapeId])).toEqual([config.accounts[0]]);
      expect(selectionChoices(getAccounts(config))).toContain(scrapeId);
      const retry = retryChoices(
        [{ companyId: CompanyTypes.hapoalim, scrapeId }],
        selectionChoices(getAccounts(config)),
      );
      expect(getAccounts(config, retry)).toEqual([config.accounts[0]]);
      expect(sendDeprecationMessage).not.toHaveBeenCalled();
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
          accountsToScrape: ["shared"],
        }),
      ),
    ).toEqual([accounts[1], accounts[2]]);
    expect(getAccounts(snapshot({ accountsToScrape: ["invented-a"] }))).toEqual(
      [],
    );
    expect(sendDeprecationMessage).not.toHaveBeenCalled();
  });
  it("gives aliases precedence over company names across the whole config", () => {
    const config = MoneymanConfigSchema.parse({
      accounts: [...accounts, { ...accounts[3], scrapeId: "hapoalim" }],
      options: { scraping: { accountsToScrape: ["hapoalim"] } },
    });
    expect(getAccounts(config)).toEqual([config.accounts[4]]);
    expect(getAccounts(config, ["home"])).toEqual([]);
    expect(selectionChoices(getAccounts(config))).toEqual(["hapoalim"]);
    expect(sendDeprecationMessage).not.toHaveBeenCalled();
  });
  it("unions mixed aliases and legacy companies without duplicating accounts", () => {
    const config = snapshot({
      accountsToScrape: ["home", "leumi", "home", "leumi", "unknown"],
    });
    expect(getAccounts(config)).toEqual([
      accounts[0],
      accounts[2],
      accounts[3],
    ]);
    expect(selectionChoices(getAccounts(config))).toEqual(["home", "shared"]);
    expect(getAccounts(config, ["shared"])).toEqual([accounts[2]]);
    expect(getAccounts(config, ["leumi"])).toEqual([]);
    expect(sendDeprecationMessage).toHaveBeenCalledWith(
      "accountsToScrapeCompanyId",
      [],
    );
  });
  it("does not warn or fall back for duplicated aliases matching company names", () => {
    const config = MoneymanConfigSchema.parse({
      accounts: [
        ...accounts,
        { ...accounts[3], scrapeId: "hapoalim" },
        { ...accounts[2], scrapeId: "hapoalim" },
      ],
      options: {
        scraping: { accountsToScrape: ["hapoalim", "home", "hapoalim"] },
      },
    });
    expect(getAccounts(config)).toEqual([
      config.accounts[0],
      config.accounts[4],
      config.accounts[5],
    ]);
    expect(sendDeprecationMessage).not.toHaveBeenCalled();
  });
  it("preserves legacy unknown-company selection without falling back to all accounts", () => {
    expect(getAccounts(snapshot({ accountsToScrape: ["unknown"] }))).toEqual(
      [],
    );
    expect(sendDeprecationMessage).not.toHaveBeenCalled();
  });
  it("matches aliases and legacy companies exactly", () => {
    expect(
      getAccounts(snapshot({ accountsToScrape: ["Home", "LEUMI", " home"] })),
    ).toEqual([]);
    expect(sendDeprecationMessage).not.toHaveBeenCalled();
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
    const config = snapshot({ accountsToScrape: ["home"] });
    expect(getAccounts(config, [])).toEqual([]);
    expect(getAccounts(config, ["shared"])).toEqual([]);
    expect(getAccounts(config, ["removed"])).toEqual([]);
    expect(getAccounts(snapshot(), ["home", "removed"])).toEqual([]);
    expect(config.accounts).toHaveLength(4);
  });
  it("shows only distinct allowed aliases and omits unnamed logins", () => {
    const choices = selectionChoices(
      getAccounts(snapshot({ accountsToScrape: ["shared"] })),
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
