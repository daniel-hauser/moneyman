import { mock, mockClear } from "jest-mock-extended";
import { BrowserContext, Page } from "puppeteer";
import {
  setupCookiePersistence,
  saveCookies,
  SerializedCookies,
} from "./cookies";
import { CompanyTypes } from "israeli-bank-scrapers";

// Mock the config module
jest.mock("../config.js", () => ({
  config: {
    options: {
      scraping: {
        enableCookiePersistence: true,
        persistedCookies: JSON.stringify({
          hapoalim: {
            cookies: [
              {
                name: "session",
                value: "test-session-value",
                domain: ".bankhapoalim.co.il",
              },
            ],
            timestamp: Date.now(),
          },
        }),
      },
    },
  },
}));

describe("Cookie Persistence", () => {
  const browserContext = mock<BrowserContext>();
  const page = mock<Page>();

  beforeEach(() => {
    jest.clearAllMocks();
    mockClear(browserContext);
    mockClear(page);
  });

  describe("setupCookiePersistence", () => {
    it("should restore cookies if available", async () => {
      browserContext.pages.mockResolvedValue([page]);
      page.setCookie.mockResolvedValue();

      await setupCookiePersistence(
        browserContext,
        CompanyTypes.hapoalim as CompanyTypes,
      );

      expect(browserContext.pages).toHaveBeenCalled();
      expect(page.setCookie).toHaveBeenCalled();
    });

    it("should handle missing cookies gracefully", async () => {
      browserContext.pages.mockResolvedValue([page]);

      await setupCookiePersistence(
        browserContext,
        CompanyTypes.discount as CompanyTypes,
      );

      expect(browserContext.pages).toHaveBeenCalled();
    });
  });

  describe("saveCookies", () => {
    it("should save cookies from page", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      const mockCookies = [
        {
          name: "session",
          value: "new-session-value",
          domain: ".test.com",
        },
      ];

      page.cookies.mockResolvedValue(mockCookies as any);

      await saveCookies(page, CompanyTypes.hapoalim as CompanyTypes);

      expect(page.cookies).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith("\n=== PERSISTED_COOKIES ===");

      consoleSpy.mockRestore();
    });

    it("should handle empty cookies", async () => {
      page.cookies.mockResolvedValue([]);

      await saveCookies(page, CompanyTypes.hapoalim as CompanyTypes);

      expect(page.cookies).toHaveBeenCalled();
    });
  });
});
