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
    it("should return undefined when harExportPath is undefined", () => {
      const preparePage = createHarPreparePage(
        CompanyTypes.hapoalim,
        undefined,
      );
      expect(preparePage).toBeUndefined();
    });

    it("should return undefined when harExportPath is empty string", () => {
      const preparePage = createHarPreparePage(CompanyTypes.hapoalim, "");
      expect(preparePage).toBeUndefined();
    });

    it("should return a function when harExportPath is provided", () => {
      const preparePage = createHarPreparePage(CompanyTypes.hapoalim, testDir);
      expect(preparePage).toBeDefined();
      expect(typeof preparePage).toBe("function");
    });

    it("should create the HAR export directory if it does not exist", () => {
      expect(existsSync(testDir)).toBe(false);

      const preparePage = createHarPreparePage(CompanyTypes.hapoalim, testDir);
      expect(preparePage).toBeDefined();
      expect(existsSync(testDir)).toBe(true);
    });

    it("should start HAR recording when preparePage is called", async () => {
      const preparePage = createHarPreparePage(CompanyTypes.hapoalim, testDir);

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
      const preparePage = createHarPreparePage(CompanyTypes.visaCal, testDir);

      expect(preparePage).toBeDefined();
      await preparePage!(mockPage);

      expect(mockHarStart).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringMatching(/visaCal-\d{4}-\d{2}-\d{2}.*\.har$/),
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
