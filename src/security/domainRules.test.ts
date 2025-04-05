import { CompanyTypes } from "israeli-bank-scrapers";
import { DomainRuleManager, Rule, loadDomainRules } from "./domainRules.js";

jest.mock("../utils/logger.js", () => ({
  createLogger: jest.fn(() => jest.fn()),
}));

describe("domainRules", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("loadDomainRules", () => {
    it("should load rules from the provided string", () => {
      const ruleManager = loadDomainRules(
        `hapoalim ALLOW api.bankhapoalim.co.il`,
      );
      const result = ruleManager.getRule(
        "https://api.bankhapoalim.co.il/login",
        CompanyTypes.hapoalim,
      );
      expect(result).toBe("ALLOW");
    });

    it("should ignore comment lines and empty lines in rules string", () => {
      const rulesString = `
        # This is a comment
        hapoalim ALLOW api.bankhapoalim.co.il
        
        # Another comment
        leumi BLOCK api.leumi.co.il
        # hapoalim BLOCK foo.bankhapoalim.co.il
      `;
      const ruleManager = loadDomainRules(rulesString);
      for (const [company, domain, rule] of [
        [CompanyTypes.hapoalim, "https://api.bankhapoalim.co.il", "ALLOW"],
        [CompanyTypes.leumi, "https://api.leumi.co.il", "BLOCK"],
        [CompanyTypes.hapoalim, "https://foo.bankhapoalim.co.il", "DEFAULT"],
      ] as const) {
        expect(ruleManager.getRule(domain, company)).toBe(rule);
      }
    });
  });

  describe("DomainRuleManager.getRule", () => {
    const ruleManager = loadDomainRules(`
            visaCal ALLOW cal-online.co.il
            visaCal BLOCK google.com
          `);

    it.each([
      ["ALLOW", "https://cal-online.co.il", CompanyTypes.visaCal],
      ["BLOCK", "https://google.com", CompanyTypes.visaCal],
      ["DEFAULT", "https://google.com", CompanyTypes.max],
      ["BLOCK", "https://www.google.com", CompanyTypes.visaCal],
      ["DEFAULT", "https://www.facebook.com", CompanyTypes.visaCal],
      ["DEFAULT", "https://fonts.gstatic.com", CompanyTypes.visaCal],
      ["ALLOW", "https://api.cal-online.co.il", CompanyTypes.visaCal],
      ["ALLOW", "https://api.cal-online.co.il", CompanyTypes.visaCal],
    ])("should return %s for %s under %s", (expected, url, company) => {
      expect(ruleManager.getRule(url, company)).toBe(expected);
    });
  });
});
