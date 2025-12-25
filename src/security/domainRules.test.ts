import { CompanyTypes } from "israeli-bank-scrapers";
import { DomainRuleManager } from "./domainRules.js";

jest.mock("../utils/logger.js", () => ({
  createLogger: jest.fn(() => jest.fn()),
}));

jest.mock("../config.js", () => ({
  config: {
    options: {
      security: {
        firewallSettings: "",
      },
    },
  },
}));

describe("domainRules", () => {
  describe("DomainRuleManager", () => {
    it("should load rules from the provided string", () => {
      const ruleManager = new DomainRuleManager(CompanyTypes.hapoalim, [
        `hapoalim ALLOW api.bankhapoalim.co.il`,
      ]);
      const result = ruleManager.getRule(
        "https://api.bankhapoalim.co.il/login",
      );
      expect(result).toBe("ALLOW");
    });
  });

  describe("DomainRuleManager.getRule", () => {
    const visaCalRuleManager = new DomainRuleManager(CompanyTypes.visaCal, [
      "visaCal ALLOW cal-online.co.il",
      "visaCal BLOCK google.com",
      "visaCal BLOCK facebook.com",
      "visaCal BLOCK fonts.gstatic.com",
    ]);

    it.each([
      ["ALLOW", "https://cal-online.co.il"],
      ["ALLOW", "https://api.cal-online.co.il"],
      ["BLOCK", "https://google.com"],
      ["BLOCK", "https://www.google.com"],
      ["BLOCK", "https://www.facebook.com"],
      ["BLOCK", "https://fonts.gstatic.com"],
      ["ALLOW", "https://other.gstatic.com"], // Not blocked subdomain
    ])("should return %s for %s (visaCal)", (expected, url) => {
      expect(visaCalRuleManager.getRule(url)).toBe(expected);
    });

    it("should default to ALLOW for other companies when no rule exists", () => {
      const hapoalimRuleManager = new DomainRuleManager(CompanyTypes.hapoalim, [
        "visaCal ALLOW cal-online.co.il",
        "visaCal BLOCK google.com",
        "visaCal BLOCK facebook.com",
      ]);
      expect(hapoalimRuleManager.getRule("https://google.com")).toBe("ALLOW");
    });
  });

  describe("DomainRuleManager.hasAnyRule", () => {
    it("should return true if company has rules defined", () => {
      const hapoalimManager = new DomainRuleManager(CompanyTypes.hapoalim, [
        "hapoalim ALLOW api.bankhapoalim.co.il",
        "leumi BLOCK api.leumi.co.il",
        "visaCal ALLOW cal-online.co.il",
      ]);
      const leumiManager = new DomainRuleManager(CompanyTypes.leumi, [
        "hapoalim ALLOW api.bankhapoalim.co.il",
        "leumi BLOCK api.leumi.co.il",
        "visaCal ALLOW cal-online.co.il",
      ]);
      const visaCalManager = new DomainRuleManager(CompanyTypes.visaCal, [
        "hapoalim ALLOW api.bankhapoalim.co.il",
        "leumi BLOCK api.leumi.co.il",
        "visaCal ALLOW cal-online.co.il",
      ]);

      expect(hapoalimManager.hasAnyRule()).toBe(true);
      expect(leumiManager.hasAnyRule()).toBe(true);
      expect(visaCalManager.hasAnyRule()).toBe(true);
    });

    it("should return false if company has no rules defined", () => {
      const maxManager = new DomainRuleManager(CompanyTypes.max, [
        "hapoalim ALLOW api.bankhapoalim.co.il",
        "leumi BLOCK api.leumi.co.il",
      ]);
      const isracardManager = new DomainRuleManager(CompanyTypes.isracard, [
        "hapoalim ALLOW api.bankhapoalim.co.il",
        "leumi BLOCK api.leumi.co.il",
      ]);

      expect(maxManager.hasAnyRule()).toBe(false);
      expect(isracardManager.hasAnyRule()).toBe(false);
    });

    it("should return false with empty rules", () => {
      const hapoalimManager = new DomainRuleManager(CompanyTypes.hapoalim, []);
      const leumiManager = new DomainRuleManager(CompanyTypes.leumi, []);

      expect(hapoalimManager.hasAnyRule()).toBe(false);
      expect(leumiManager.hasAnyRule()).toBe(false);
    });
  });

  describe("DomainRuleManager blockByDefault behavior", () => {
    it("should default to ALLOW when blockByDefault is false (default)", () => {
      const ruleManager = new DomainRuleManager(CompanyTypes.hapoalim, []);

      // Test with no rules defined - should default to ALLOW
      expect(ruleManager.getRule("https://example.com")).toBe("ALLOW");
      expect(ruleManager.getRule("https://unknown-domain.com")).toBe("ALLOW");
    });

    it("should default to ALLOW when blockByDefault is explicitly false", () => {
      const ruleManager = new DomainRuleManager(
        CompanyTypes.hapoalim,
        [],
        false,
      );

      // Test with no rules defined - should default to ALLOW
      expect(ruleManager.getRule("https://example.com")).toBe("ALLOW");
      expect(ruleManager.getRule("https://unknown-domain.com")).toBe("ALLOW");
    });

    it("should default to BLOCK when blockByDefault is true", () => {
      const ruleManager = new DomainRuleManager(
        CompanyTypes.hapoalim,
        [],
        true,
      );

      // Test with no rules defined - should default to BLOCK
      expect(ruleManager.getRule("https://example.com")).toBe("BLOCK");
      expect(ruleManager.getRule("https://unknown-domain.com")).toBe("BLOCK");
    });

    it("should respect explicit rules regardless of blockByDefault setting", () => {
      const rules = [
        "hapoalim ALLOW api.bankhapoalim.co.il",
        "hapoalim BLOCK malicious.com",
      ];

      // Test with blockByDefault = false
      const allowByDefaultManager = new DomainRuleManager(
        CompanyTypes.hapoalim,
        rules,
        false,
      );
      expect(
        allowByDefaultManager.getRule("https://api.bankhapoalim.co.il"),
      ).toBe("ALLOW");
      expect(allowByDefaultManager.getRule("https://malicious.com")).toBe(
        "BLOCK",
      );
      expect(allowByDefaultManager.getRule("https://unknown.com")).toBe(
        "ALLOW",
      ); // Default

      // Test with blockByDefault = true
      const blockByDefaultManager = new DomainRuleManager(
        CompanyTypes.hapoalim,
        rules,
        true,
      );
      expect(
        blockByDefaultManager.getRule("https://api.bankhapoalim.co.il"),
      ).toBe("ALLOW");
      expect(blockByDefaultManager.getRule("https://malicious.com")).toBe(
        "BLOCK",
      );
      expect(blockByDefaultManager.getRule("https://unknown.com")).toBe(
        "BLOCK",
      ); // Default
    });
  });

  // GLOBAL rules not supported in this change
});
