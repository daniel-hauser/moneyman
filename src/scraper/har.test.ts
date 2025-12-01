import { mock, mockClear } from "jest-mock-extended";
import type { Page } from "puppeteer";
import { CompanyTypes } from "israeli-bank-scrapers";
import { existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";

// Mock puppeteer-har module
const mockHarStart = jest.fn();
const mockHarStop = jest.fn();
jest.mock("puppeteer-har", () => {
  return jest.fn().mockImplementation(() => ({
    start: mockHarStart,
    stop: mockHarStop,
  }));
});

// Mock notifier to avoid Telegram calls
jest.mock("../bot/notifier.js", () => ({
  sendDocument: jest.fn().mockResolvedValue(undefined),
}));

import { createHarPreparePage, stopHarRecording } from "./har";

describe("HAR recording", () => {
  const testDir = "/tmp/test-har-exports";
  const mockPage = mock<Page>();

  beforeEach(() => {
    jest.clearAllMocks();
    mockClear(mockPage);
    mockHarStart.mockReset();
    mockHarStop.mockReset();

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory after each test
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("createHarPreparePage", () => {
    it("should return undefined when no options are enabled", () => {
      const preparePage = createHarPreparePage(CompanyTypes.hapoalim, {});
      expect(preparePage).toBeUndefined();
    });

    it("should return undefined when exportPath is empty and sendToTelegram is false", () => {
      const preparePage = createHarPreparePage(CompanyTypes.hapoalim, {
        exportPath: "",
        sendToTelegram: false,
      });
      expect(preparePage).toBeUndefined();
    });

    it("should return a function when exportPath is provided", () => {
      const preparePage = createHarPreparePage(CompanyTypes.hapoalim, {
        exportPath: testDir,
      });
      expect(preparePage).toBeDefined();
      expect(typeof preparePage).toBe("function");
    });

    it("should return a function when sendToTelegram is true", () => {
      const preparePage = createHarPreparePage(CompanyTypes.hapoalim, {
        sendToTelegram: true,
      });
      expect(preparePage).toBeDefined();
      expect(typeof preparePage).toBe("function");
    });

    it("should create the HAR export directory if it does not exist", () => {
      expect(existsSync(testDir)).toBe(false);

      const preparePage = createHarPreparePage(CompanyTypes.hapoalim, {
        exportPath: testDir,
      });
      expect(preparePage).toBeDefined();
      expect(existsSync(testDir)).toBe(true);
    });

    it("should start HAR recording when preparePage is called", async () => {
      const preparePage = createHarPreparePage(CompanyTypes.hapoalim, {
        exportPath: testDir,
      });

      expect(preparePage).toBeDefined();
      await preparePage!(mockPage);

      expect(mockHarStart).toHaveBeenCalledTimes(1);
      expect(mockHarStart).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining("hapoalim-"),
        }),
      );
    });

    it("should generate HAR file path with company ID and timestamp", async () => {
      const preparePage = createHarPreparePage(CompanyTypes.visaCal, {
        exportPath: testDir,
      });

      expect(preparePage).toBeDefined();
      await preparePage!(mockPage);

      expect(mockHarStart).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringMatching(/visaCal-\d{4}-\d{2}-\d{2}.*\.har$/),
        }),
      );
    });

    it("should use temp directory when only sendToTelegram is enabled", async () => {
      const preparePage = createHarPreparePage(CompanyTypes.hapoalim, {
        sendToTelegram: true,
      });

      expect(preparePage).toBeDefined();
      await preparePage!(mockPage);

      expect(mockHarStart).toHaveBeenCalledTimes(1);
      expect(mockHarStart).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining("hapoalim-"),
        }),
      );
    });
  });

  describe("stopHarRecording", () => {
    it("should not throw when called on a page without HAR recording", async () => {
      const page = mock<Page>();
      await expect(stopHarRecording(page)).resolves.not.toThrow();
    });
  });
});
