import { CompanyTypes } from "israeli-bank-scrapers";
import { getSummaryMessages } from "./messages.js";
import { AccountScrapeResult } from "../types.js";
import { ScraperErrorTypes } from "israeli-bank-scrapers/lib/scrapers/errors.js";

describe("Expandable Block Quotation Messages", () => {
  it("should put successful accounts in expandable block quotation", () => {
    const results: Array<AccountScrapeResult> = [
      {
        companyId: CompanyTypes.hapoalim,
        result: {
          success: true,
          accounts: [
            {
              accountNumber: "12345",
              txns: [
                {
                  type: "normal" as any,
                  date: "2023-01-01",
                  processedDate: "2023-01-01",
                  description: "Test transaction",
                  originalAmount: 100,
                  originalCurrency: "ILS",
                  chargedAmount: 100,
                  chargedCurrency: "ILS",
                  status: "completed" as any,
                },
              ],
            },
          ],
        },
      },
    ];

    const summary = getSummaryMessages(results);

    expect(summary).toContain("**>Successful Account Updates");
    expect(summary).toContain("✔️ [hapoalim] 12345: 1");
  });

  it("should keep error accounts outside expandable block", () => {
    const results: Array<AccountScrapeResult> = [
      {
        companyId: CompanyTypes.max,
        result: {
          success: false,
          errorType: ScraperErrorTypes.Generic,
          errorMessage: "Connection failed",
        },
      },
      {
        companyId: CompanyTypes.hapoalim,
        result: {
          success: true,
          accounts: [
            {
              accountNumber: "67890",
              txns: [],
            },
          ],
        },
      },
    ];

    const summary = getSummaryMessages(results);

    // Error should appear before the expandable block
    const errorIndex = summary.indexOf("❌ [max] GENERIC");
    const expandableIndex = summary.indexOf("**>Successful Account Updates");

    expect(errorIndex).toBeGreaterThan(-1);
    expect(expandableIndex).toBeGreaterThan(-1);
    expect(errorIndex).toBeLessThan(expandableIndex);

    // Success should be in expandable block
    expect(summary).toContain("**>Successful Account Updates");
    expect(summary).toContain("✔️ [hapoalim] 67890: 0");
  });

  it("should handle only error accounts without expandable block", () => {
    const results: Array<AccountScrapeResult> = [
      {
        companyId: CompanyTypes.max,
        result: {
          success: false,
          errorType: ScraperErrorTypes.ChangePassword,
        },
      },
    ];

    const summary = getSummaryMessages(results);

    expect(summary).toContain("❌ [max] CHANGE_PASSWORD");
    expect(summary).not.toContain("**>Successful Account Updates");
  });

  it("should handle no accounts with default message", () => {
    const results: Array<AccountScrapeResult> = [];

    const summary = getSummaryMessages(results);

    expect(summary).toContain("😶 None");
    expect(summary).not.toContain("**>Successful Account Updates");
  });
});
