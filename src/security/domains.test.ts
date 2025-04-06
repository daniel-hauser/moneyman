import { jest } from "@jest/globals";
import { CompanyTypes } from "israeli-bank-scrapers";
import { initDomainTracking, reportUsedDomains } from "./domains.js";
import {
  BrowserContext,
  TargetType,
  Target,
  Page,
  HTTPRequest,
  Frame,
} from "puppeteer";
import { mock } from "jest-mock-extended";

jest.mock("../utils/logger.js", () => ({
  createLogger: jest.fn(() => jest.fn()),
}));

describe("domains", () => {
  let originalEnv: NodeJS.ProcessEnv;
  const browserContext = mock<BrowserContext>();

  beforeEach(() => {
    originalEnv = process.env;
    jest.resetAllMocks();
    process.env = { ...originalEnv, DOMAIN_TRACKING_ENABLED: "true" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("initDomainTracking", () => {
    it("should not set up event listeners when domain tracking is disabled", async () => {
      process.env.DOMAIN_TRACKING_ENABLED = "";
      await initDomainTracking(browserContext, CompanyTypes.max);
      expect(browserContext.on).not.toHaveBeenCalled();
    });

    it("should set up event listeners when domain tracking is enabled", async () => {
      await initDomainTracking(browserContext, CompanyTypes.max);
      expect(browserContext.on).toHaveBeenCalledWith(
        "targetcreated",
        expect.any(Function),
      );
    });

    it("should set up page request listener for relevant target types", async () => {
      const target = mock<Target>();
      target.type.mockReturnValue(TargetType.PAGE);

      const page = mock<Page>();
      page.url.mockReturnValue("https://foo.com");
      target.page.mockResolvedValue(page);

      process.env.FIREWALL_SETTINGS = `
      max ALLOW bar.com
      max BLOCK baz.com
      `;
      await initDomainTracking(browserContext, CompanyTypes.max);

      const targetCreatedCallback = browserContext.on.mock.calls[0][1] as (
        target: Target,
      ) => Promise<void>;
      await targetCreatedCallback(target);

      expect(page.setRequestInterception).toHaveBeenCalledWith(true);
      expect(page.on).toHaveBeenCalledTimes(2);
      expect(page.on).toHaveBeenNthCalledWith(
        1,
        "framenavigated",
        expect.any(Function),
      );
      expect(page.on).toHaveBeenNthCalledWith(
        2,
        "request",
        expect.any(Function),
      );
      const [[, framenavigated], [, request]] = page.on.mock.calls;
      const framenavigatedCallback = framenavigated as (f: Frame) => void;

      framenavigatedCallback(
        mock<Frame>({ url: () => "https://bar.com/hello" }),
      );

      const mockRequestBar = mock<HTTPRequest>({
        url: () => "https://bar.com",
      });
      const mockRequestBaz = mock<HTTPRequest>({
        url: () => "https://baz.com",
      });
      const requestCallback = request as (r: HTTPRequest) => void;
      requestCallback(mockRequestBar);
      requestCallback(mockRequestBaz);

      expect(mockRequestBar.continue).toHaveBeenCalled();
      expect(mockRequestBaz.abort).toHaveBeenCalled();

      await reportUsedDomains(async (report) => {
        expect(report).toMatchSnapshot();
      });
    });

    it("should handle requests correctly", async () => {
      const target = mock<Target>();
      target.type.mockReturnValue(TargetType.OTHER);

      await initDomainTracking(browserContext, CompanyTypes.max);

      const targetCreatedCallback = browserContext.on.mock.calls[0][1];
      targetCreatedCallback(target);
      expect(target.page).not.toHaveBeenCalled();
    });
  });
});
