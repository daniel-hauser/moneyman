import { jest } from "@jest/globals";
import { mock } from "jest-mock-extended";
import type { Telegraf } from "telegraf";
import type { RunMetadata } from "./types.js";

// Mock dependencies before importing the module under test
jest.mock("dotenv/config", () => ({}));
jest.mock("telegraf", () => ({ Telegraf: mock<Telegraf>() }));
jest.mock("./security/domains.js", () => ({
  getUsedDomains: jest
    .fn<() => Promise<Partial<Record<string, unknown>>>>()
    .mockResolvedValue({ testCompany: ["domain1.com"] }),
  monitorNodeConnections: jest.fn(),
}));
jest.mock("./utils/logger.js", () => ({
  createLogger: () => jest.fn(),
  logToPublicLog: jest.fn(),
  metadataLogEntries: ["log1", "log2"],
}));

describe("runnerMetadata", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("reportRunMetadata", () => {
    it("should skip reporting when reportRunMetadata is disabled (default)", async () => {
      process.env = {
        ...originalEnv,
        MONEYMAN_CONFIG: JSON.stringify({
          accounts: [{ companyId: "test", password: "pass" }],
          storage: { localJson: { enabled: true } },
          options: {
            scraping: {},
            security: {},
            notifications: {
              telegram: {
                apiKey: "test-key",
                chatId: "test-chat-id",
              },
            },
            logging: {},
          },
        }),
      };

      const { reportRunMetadata } = await import("./runnerMetadata.js");
      const mockReport = jest.fn<(metadata: RunMetadata) => Promise<void>>();

      await reportRunMetadata(mockReport);

      expect(mockReport).not.toHaveBeenCalled();
    });

    it("should call report with metadata when reportRunMetadata is enabled", async () => {
      process.env = {
        ...originalEnv,
        MONEYMAN_CONFIG: JSON.stringify({
          accounts: [{ companyId: "test", password: "pass" }],
          storage: { localJson: { enabled: true } },
          options: {
            scraping: {},
            security: {},
            notifications: {
              telegram: {
                apiKey: "test-key",
                chatId: "test-chat-id",
                reportRunMetadata: true,
              },
            },
            logging: {},
          },
        }),
      };

      const { reportRunMetadata } = await import("./runnerMetadata.js");
      const mockReport = jest.fn<(metadata: RunMetadata) => Promise<void>>();

      await reportRunMetadata(mockReport);

      expect(mockReport).toHaveBeenCalledTimes(1);
      expect(mockReport).toHaveBeenCalledWith({
        domainsByCompany: {},
        networkInfo: {},
        metadataLogEntries: ["log1", "log2"],
      });
    });

    it("should include used domains when reportUsedDomains is enabled", async () => {
      process.env = {
        ...originalEnv,
        MONEYMAN_CONFIG: JSON.stringify({
          accounts: [{ companyId: "test", password: "pass" }],
          storage: { localJson: { enabled: true } },
          options: {
            scraping: {},
            security: {},
            notifications: {
              telegram: {
                apiKey: "test-key",
                chatId: "test-chat-id",
                reportRunMetadata: true,
                reportUsedDomains: true,
              },
            },
            logging: {},
          },
        }),
      };

      const { reportRunMetadata } = await import("./runnerMetadata.js");
      const mockReport = jest.fn<(metadata: RunMetadata) => Promise<void>>();

      await reportRunMetadata(mockReport);

      expect(mockReport).toHaveBeenCalledTimes(1);
      expect(mockReport).toHaveBeenCalledWith({
        domainsByCompany: { testCompany: ["domain1.com"] },
        networkInfo: {},
        metadataLogEntries: ["log1", "log2"],
      });
    });

    it("should include external IP when reportExternalIp is enabled", async () => {
      // Mock global fetch
      global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        json: () => Promise.resolve({ ip: "1.2.3.4" }),
      } as Response);

      process.env = {
        ...originalEnv,
        MONEYMAN_CONFIG: JSON.stringify({
          accounts: [{ companyId: "test", password: "pass" }],
          storage: { localJson: { enabled: true } },
          options: {
            scraping: {},
            security: {},
            notifications: {
              telegram: {
                apiKey: "test-key",
                chatId: "test-chat-id",
                reportRunMetadata: true,
                reportExternalIp: true,
              },
            },
            logging: {},
          },
        }),
      };

      const { reportRunMetadata } = await import("./runnerMetadata.js");
      const mockReport = jest.fn<(metadata: RunMetadata) => Promise<void>>();

      await reportRunMetadata(mockReport);

      expect(mockReport).toHaveBeenCalledTimes(1);
      expect(mockReport).toHaveBeenCalledWith({
        domainsByCompany: {},
        networkInfo: { ip: "1.2.3.4" },
        metadataLogEntries: ["log1", "log2"],
      });
    });

    it("should include both domains and IP when both are enabled", async () => {
      // Mock global fetch
      global.fetch = jest.fn<typeof fetch>().mockResolvedValue({
        json: () => Promise.resolve({ ip: "1.2.3.4" }),
      } as Response);

      process.env = {
        ...originalEnv,
        MONEYMAN_CONFIG: JSON.stringify({
          accounts: [{ companyId: "test", password: "pass" }],
          storage: { localJson: { enabled: true } },
          options: {
            scraping: {},
            security: {},
            notifications: {
              telegram: {
                apiKey: "test-key",
                chatId: "test-chat-id",
                reportRunMetadata: true,
                reportUsedDomains: true,
                reportExternalIp: true,
              },
            },
            logging: {},
          },
        }),
      };

      const { reportRunMetadata } = await import("./runnerMetadata.js");
      const mockReport = jest.fn<(metadata: RunMetadata) => Promise<void>>();

      await reportRunMetadata(mockReport);

      expect(mockReport).toHaveBeenCalledTimes(1);
      expect(mockReport).toHaveBeenCalledWith({
        domainsByCompany: { testCompany: ["domain1.com"] },
        networkInfo: { ip: "1.2.3.4" },
        metadataLogEntries: ["log1", "log2"],
      });
    });

    it("should skip reporting when telegram config is not set", async () => {
      process.env = {
        ...originalEnv,
        MONEYMAN_CONFIG: JSON.stringify({
          accounts: [{ companyId: "test", password: "pass" }],
          storage: { localJson: { enabled: true } },
          options: {
            scraping: {},
            security: {},
            notifications: {},
            logging: {},
          },
        }),
      };

      const { reportRunMetadata } = await import("./runnerMetadata.js");
      const mockReport = jest.fn<(metadata: RunMetadata) => Promise<void>>();

      await reportRunMetadata(mockReport);

      expect(mockReport).not.toHaveBeenCalled();
    });
  });
});
