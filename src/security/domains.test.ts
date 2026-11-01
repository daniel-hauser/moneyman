import { jest } from "@jest/globals";
import { CompanyTypes } from "israeli-bank-scrapers";
import {
  type BrowserContext,
  type Target,
  type Page,
  type HTTPRequest,
  type InterceptResolutionAction,
  type Frame,
} from "puppeteer";
import { mock } from "jest-mock-extended";
import http from "node:http";
import type { DomainTracker, createDomainTracker } from "./domains.js";

jest.mock("../utils/logger.js", () => ({
  createLogger: jest.fn(() => jest.fn()),
}));

const trackers = new Set<DomainTracker>();
async function loadDomains(
  settings: Parameters<typeof createDomainTracker>[0],
) {
  const domains = await import("./domains.js");
  const tracker = domains.createDomainTracker(settings);
  trackers.add(tracker);
  return tracker;
}

describe("domains", () => {
  const browserContext = mock<BrowserContext>();

  beforeEach(() => {
    jest.resetAllMocks();
    jest.resetModules();
  });
  afterEach(() => {
    for (const tracker of trackers) tracker.dispose();
    trackers.clear();
    jest.restoreAllMocks();
  });

  it("merges multiple workers and parent contexts without clobbering or mutating inputs", async () => {
    const { mergeUsedDomains } = await import("./domains.js");
    const parent = { node: { shared: ["GET parent.test", "GET shared.test"] } };
    const first = {
      max: { allowed: ["GET first.test"], pages: ["first.test/login"] },
      node: { shared: ["GET shared.test", "GET first.test"] },
    };
    const second = {
      max: { allowed: ["GET second.test"], blocked: ["POST blocked.test"] },
      node: { shared: ["GET second.test"], other: ["POST other.test"] },
    };
    const original = structuredClone([parent, first, second]);
    expect(mergeUsedDomains(parent, first, second)).toEqual({
      max: {
        allowed: ["GET first.test", "GET second.test"],
        pages: ["first.test/login"],
        blocked: ["POST blocked.test"],
      },
      node: {
        shared: [
          "GET parent.test",
          "GET shared.test",
          "GET first.test",
          "GET second.test",
        ],
        other: ["POST other.test"],
      },
    });
    expect([parent, first, second]).toEqual(original);
    expect(mergeUsedDomains(parent)).toEqual(parent);
    const tracker = await loadDomains({
      domainTracking: false,
      blockByDefault: false,
    });
    await expect(tracker.getUsedDomains()).resolves.toEqual({});
  });

  it("owns independent rules and domain data without retaining mutable settings", async () => {
    const settings = {
      domainTracking: true,
      blockByDefault: true,
      firewallSettings: ["max ALLOW first.test"],
    };
    const first = await loadDomains(settings);
    settings.domainTracking = false;
    settings.blockByDefault = false;
    settings.firewallSettings.push("max ALLOW second.test");
    const second = await loadDomains({
      domainTracking: true,
      blockByDefault: true,
      firewallSettings: ["max ALLOW second.test"],
    });
    const requests = async (tracker: DomainTracker) => {
      const context = mock<BrowserContext>();
      const page = mock<Page>();
      page.url.mockReturnValue("https://bank.test");
      const target = mock<Target>({
        type: () => "page" as ReturnType<Target["type"]>,
      });
      target.page.mockResolvedValue(page);
      await tracker.initDomainTracking(context, CompanyTypes.max);
      const created = context.on.mock.calls[0][1] as (
        target: Target,
      ) => Promise<void>;
      await created(target);
      return page.on.mock.calls.find(([event]) => event === "request")![1] as (
        request: HTTPRequest,
      ) => Promise<void>;
    };
    const firstRequest = await requests(first);
    const secondRequest = await requests(second);
    const allowed = mockHttpRequest("https://first.test");
    const blocked = mockHttpRequest("https://second.test");
    await firstRequest(allowed);
    await firstRequest(blocked);
    await secondRequest(mockHttpRequest("https://second.test"));
    await secondRequest(mockHttpRequest("https://first.test"));
    expect(allowed.continue).toHaveBeenCalled();
    expect(blocked.abort).toHaveBeenCalled();
    await expect(first.getUsedDomains()).resolves.toMatchObject({
      max: {
        allowed: ["GET first.test [document]"],
        blocked: ["GET second.test [document]"],
      },
    });
    await expect(second.getUsedDomains()).resolves.toMatchObject({
      max: {
        allowed: ["GET second.test [document]"],
        blocked: ["GET first.test [document]"],
      },
    });
    const next = await loadDomains({
      domainTracking: true,
      blockByDefault: false,
    });
    await expect(next.getUsedDomains()).resolves.toEqual({});
  });

  it("records Node requests and logger contexts only in the owning tracker", async () => {
    const { ClientRequestInterceptor } =
      await import("@mswjs/interceptors/ClientRequest");
    const instances: InstanceType<typeof ClientRequestInterceptor>[] = [];
    const apply = ClientRequestInterceptor.prototype.apply;
    jest
      .spyOn(ClientRequestInterceptor.prototype, "apply")
      .mockImplementation(function (
        this: InstanceType<typeof ClientRequestInterceptor>,
        owner,
      ) {
        instances.push(this);
        apply.call(this, owner);
      });
    const first = await loadDomains({
      domainTracking: true,
      blockByDefault: false,
    });
    const second = await loadDomains({
      domainTracking: true,
      blockByDefault: false,
    });
    const { loggerContextStore } = await import("../utils/asyncContext.js");
    for (const [index, prefix, url] of [
      [0, "first", "https://first.test"],
      [1, "second", "https://second.test"],
    ] as const) {
      const listener = instances[index].listeners("request")[index];
      await loggerContextStore.run({ prefix }, () =>
        listener(
          mock<Parameters<typeof listener>[0]>({ request: new Request(url) }),
        ),
      );
    }
    await expect(first.getUsedDomains()).resolves.toEqual({
      node: { first: ["GET first.test"] },
    });
    await expect(second.getUsedDomains()).resolves.toEqual({
      node: { second: ["GET second.test"] },
    });
    first.dispose();
    const remaining = instances[0].listeners("request");
    expect(remaining).toHaveLength(1);
    await remaining[0](
      mock<Parameters<(typeof remaining)[0]>[0]>({
        request: new Request("https://later.test"),
      }),
    );
    await expect(first.getUsedDomains()).resolves.toEqual({
      node: { first: ["GET first.test"] },
    });
    await expect(second.getUsedDomains()).resolves.toEqual({
      node: { second: ["GET second.test"], node: ["GET later.test"] },
    });
  });

  it("restores Node interception only after all owning trackers are disposed", async () => {
    const original = http.request;
    const first = await loadDomains({
      domainTracking: true,
      blockByDefault: false,
    });
    const second = await loadDomains({
      domainTracking: true,
      blockByDefault: false,
    });
    expect(http.request).not.toBe(original);
    first.dispose();
    expect(http.request).not.toBe(original);
    second.dispose();
    expect(http.request).toBe(original);
  });

  it("disposes its interceptor when setup fails", async () => {
    const { ClientRequestInterceptor } =
      await import("@mswjs/interceptors/ClientRequest");
    const dispose = jest.spyOn(ClientRequestInterceptor.prototype, "dispose");
    jest
      .spyOn(ClientRequestInterceptor.prototype, "apply")
      .mockImplementationOnce(() => {
        throw new Error("interceptor setup failed");
      });
    const { createDomainTracker } = await import("./domains.js");
    expect(() =>
      createDomainTracker({ domainTracking: true, blockByDefault: false }),
    ).toThrow("interceptor setup failed");
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  describe("initDomainTracking", () => {
    it("should not set up event listeners when domain tracking is disabled", async () => {
      const original = http.request;
      const { initDomainTracking } = await loadDomains({
        domainTracking: false,
        blockByDefault: false,
      });
      await initDomainTracking(browserContext, CompanyTypes.max);
      expect(browserContext.on).not.toHaveBeenCalled();
      expect(http.request).toBe(original);
    });

    it("should set up event listeners when domain tracking is enabled", async () => {
      const { initDomainTracking } = await loadDomains({
        domainTracking: true,
        blockByDefault: false,
      });
      await initDomainTracking(browserContext, CompanyTypes.max);
      expect(browserContext.on).toHaveBeenCalledWith(
        "targetcreated",
        expect.any(Function),
      );
    });

    it("should set up page request listener for relevant target types", async () => {
      const target = mock<Target>();
      // Value imports from puppeteer crash Jest (ESM); safe to use TargetType.PAGE when Jest supports ESM
      target.type.mockReturnValue("page" as any);

      const page = mock<Page>();
      page.url.mockReturnValue("https://foo.com");
      target.page.mockResolvedValue(page);

      const { initDomainTracking, getUsedDomains } = await loadDomains({
        domainTracking: true,
        blockByDefault: false,
        firewallSettings: ["max ALLOW bar.com", "max BLOCK baz.com"],
      });
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

      const mockRequestBar = mockHttpRequest("https://bar.com");
      const mockRequestBar2 = mockHttpRequest("https://bar.com", {
        method: "POST",
      });
      const mockRequestBaz = mockHttpRequest("https://baz.com");
      const mockRequestBaz2 = mockHttpRequest("https://baz.com", {
        resourceType: "xhr",
      });
      const requestCallback = request as (r: HTTPRequest) => void;
      requestCallback(mockRequestBar);
      requestCallback(mockRequestBaz);
      requestCallback(mockRequestBaz2);
      requestCallback(mockRequestBar2);

      expect(mockRequestBar.continue).toHaveBeenCalled();
      expect(mockRequestBaz.abort).toHaveBeenCalled();

      await expect(getUsedDomains()).resolves.toMatchSnapshot();
    });

    it("should handle requests correctly", async () => {
      const target = mock<Target>();
      // Value imports from puppeteer crash Jest (ESM); safe to use TargetType.OTHER when Jest supports ESM
      target.type.mockReturnValue("other" as any);

      const { initDomainTracking } = await loadDomains({
        domainTracking: true,
        blockByDefault: false,
      });
      await initDomainTracking(browserContext, CompanyTypes.max);

      const targetCreatedCallback = browserContext.on.mock.calls[0][1];
      targetCreatedCallback(target);
      expect(target.page).not.toHaveBeenCalled();
    });
  });
});

function mockHttpRequest(
  url: string,
  { method = "GET", resourceType = "document" } = {},
): HTTPRequest {
  const req = mock<HTTPRequest>();
  req.url.mockReturnValue(url);
  req.continue.mockResolvedValue();
  req.abort.mockResolvedValue();
  req.interceptResolutionState.mockReturnValue({
    action: "none" as InterceptResolutionAction,
  });
  req.method.mockReturnValue(method);
  req.resourceType.mockReturnValue(resourceType as any);
  return req;
}
