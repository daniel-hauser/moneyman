import {
  LegacyMoneymanConfigSchema,
  ScraperAppConfigSchema,
} from "./config.schema.js";

describe("security configuration defaults", () => {
  it("preserves the legacy allow-by-default behavior", () => {
    const config = LegacyMoneymanConfigSchema.parse({});

    expect(config.options.security.blockByDefault).toBe(false);
  });

  it("makes new scraper-only configuration deny by default", () => {
    const config = ScraperAppConfigSchema.parse({
      accounts: [{ companyId: "max", password: "synthetic" }],
      options: {},
    });

    expect(config.options.security.blockByDefault).toBe(true);
  });
});
