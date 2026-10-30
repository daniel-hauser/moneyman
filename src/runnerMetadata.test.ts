import { jest } from "@jest/globals";
import { mock } from "jest-mock-extended";
import type { Telegraf } from "telegraf";

jest.mock("dotenv/config", () => ({}));
jest.mock("telegraf", () => ({ Telegraf: mock<Telegraf>() }));
jest.mock("./utils/logger.js", () => ({
  createLogger: jest.fn(() => jest.fn()),
}));

// Mock fetch globally
const mockFetch = jest.fn<typeof fetch>();
global.fetch = mockFetch;

describe("runnerMetadata", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    jest.resetModules();
    mockFetch.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("logs explicit worker unions without carrying worker domains into the next run", async () => {
    process.env = {
      ...originalEnv,
      MONEYMAN_CONFIG: JSON.stringify({
        accounts: [],
        storage: { localJson: { enabled: true } },
      }),
    };
    const { logRunMetadata } = await import("./runnerMetadata.js");
    const { createLogger } = await import("./utils/logger.js");
    const mockedLogger = jest.mocked(createLogger);
    const index = mockedLogger.mock.calls.findIndex(
      ([namespace]) => namespace === "runner-metadata",
    );
    const logger = mockedLogger.mock.results[index].value;
    const parentDomains = { node: { shared: ["GET parent.test"] } };
    await logRunMetadata(
      parentDomains,
      {
        max: { allowed: ["GET first.test"] },
        node: { shared: ["GET worker.test"] },
      },
      {
        max: { allowed: ["GET second.test"] },
        node: { shared: ["GET worker.test"] },
      },
    );
    expect(logger).toHaveBeenLastCalledWith("Used domains:", {
      max: { allowed: ["GET first.test", "GET second.test"] },
      node: { shared: ["GET parent.test", "GET worker.test"] },
    });
    await logRunMetadata(parentDomains);
    expect(logger).toHaveBeenLastCalledWith("Used domains:", {
      node: { shared: ["GET parent.test"] },
    });
  });

  describe("getExternalIp", () => {
    it("should return 'disabled' when getIpInfoUrl is false", async () => {
      const configWithDisabledIp = {
        accounts: [{ companyId: "test", password: "pass" }],
        storage: { localJson: { enabled: true } },
        options: {
          scraping: {},
          security: {},
          notifications: {},
          logging: {
            getIpInfoUrl: false,
          },
        },
      };

      process.env = {
        ...originalEnv,
        MONEYMAN_CONFIG: JSON.stringify(configWithDisabledIp),
      };

      // Import after setting env
      const { getExternalIp } = await import("./runnerMetadata.js");

      const result = await getExternalIp();

      expect(result).toEqual({ ip: "disabled" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should fetch from URL when getIpInfoUrl is a valid URL", async () => {
      const mockIpData = { ip: "192.168.1.1", city: "Test City" };
      mockFetch.mockResolvedValue({
        json: async () => mockIpData,
      } as Response);

      const configWithCustomUrl = {
        accounts: [{ companyId: "test", password: "pass" }],
        storage: { localJson: { enabled: true } },
        options: {
          scraping: {},
          security: {},
          notifications: {},
          logging: {
            getIpInfoUrl: "https://api.myservice.com/ip",
          },
        },
      };

      process.env = {
        ...originalEnv,
        MONEYMAN_CONFIG: JSON.stringify(configWithCustomUrl),
      };

      // Import after setting env
      const { getExternalIp } = await import("./runnerMetadata.js");

      const result = await getExternalIp();

      expect(result).toEqual(mockIpData);
      expect(mockFetch).toHaveBeenCalledWith("https://api.myservice.com/ip");
    });

    it("should return 'unknown' when fetch fails", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const configWithUrl = {
        accounts: [{ companyId: "test", password: "pass" }],
        storage: { localJson: { enabled: true } },
        options: {
          scraping: {},
          security: {},
          notifications: {},
          logging: {
            getIpInfoUrl: "https://ipinfo.io/json",
          },
        },
      };

      process.env = {
        ...originalEnv,
        MONEYMAN_CONFIG: JSON.stringify(configWithUrl),
      };

      // Import after setting env
      const { getExternalIp } = await import("./runnerMetadata.js");

      const result = await getExternalIp();

      expect(result).toEqual({ ip: "unknown" });
      expect(mockFetch).toHaveBeenCalledWith("https://ipinfo.io/json");
    });

    it("should use default URL when getIpInfoUrl is not specified", async () => {
      const mockIpData = { ip: "1.2.3.4" };
      mockFetch.mockResolvedValue({
        json: async () => mockIpData,
      } as Response);

      const configWithDefaults = {
        accounts: [{ companyId: "test", password: "pass" }],
        storage: { localJson: { enabled: true } },
        options: {
          scraping: {},
          security: {},
          notifications: {},
          logging: {},
        },
      };

      process.env = {
        ...originalEnv,
        MONEYMAN_CONFIG: JSON.stringify(configWithDefaults),
      };

      // Import after setting env
      const { getExternalIp } = await import("./runnerMetadata.js");

      const result = await getExternalIp();

      expect(result).toEqual(mockIpData);
      expect(mockFetch).toHaveBeenCalledWith("https://ipinfo.io/json");
    });
  });
});
