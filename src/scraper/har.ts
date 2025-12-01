import type { Page } from "puppeteer";
import type { CompanyTypes } from "israeli-bank-scrapers";
import { createLogger } from "../utils/logger.js";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

const logger = createLogger("har");

// Dynamic import for CommonJS module
async function createHarRecorder(page: Page) {
  const PuppeteerHar = (await import("puppeteer-har")).default;
  return new PuppeteerHar(page);
}

export interface HarRecorder {
  start(): Promise<void>;
  stop(): Promise<void>;
}

// Store active HAR recorders to stop them later
const activeRecorders = new Map<Page, HarRecorder>();

/**
 * Creates a preparePage function that starts HAR recording on page creation.
 * @param companyId The company ID for naming the HAR file
 * @param harExportPath The directory path to save HAR files to
 * @returns A function to be passed to the scraper's preparePage option
 */
export function createHarPreparePage(
  companyId: CompanyTypes,
  harExportPath: string | undefined,
): ((page: Page) => Promise<void>) | undefined {
  if (!harExportPath) {
    return undefined;
  }

  // Ensure the directory exists
  if (!existsSync(harExportPath)) {
    logger("Creating HAR export directory: %s", harExportPath);
    mkdirSync(harExportPath, { recursive: true });
  }

  return async (page: Page) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const harFilePath = join(harExportPath, `${companyId}-${timestamp}.har`);

    logger(
      "Creating HAR recorder for %s, will save to %s",
      companyId,
      harFilePath,
    );

    const har = await createHarRecorder(page);

    const recorder: HarRecorder = {
      async start() {
        logger("Starting HAR recording for %s", companyId);
        await har.start({ path: harFilePath });
      },
      async stop() {
        logger(
          "Stopping HAR recording for %s, saving to %s",
          companyId,
          harFilePath,
        );
        await har.stop();
        logger("HAR file saved: %s", harFilePath);
      },
    };

    activeRecorders.set(page, recorder);
    await recorder.start();

    // Set up auto-cleanup when page closes
    page.once("close", async () => {
      const rec = activeRecorders.get(page);
      if (rec) {
        try {
          await rec.stop();
        } catch (e) {
          logger("Error stopping HAR recorder on page close: %o", e);
        }
        activeRecorders.delete(page);
      }
    });
  };
}

/**
 * Stops the HAR recorder for a specific page.
 * @param page The page to stop HAR recording for
 */
export async function stopHarRecording(page: Page): Promise<void> {
  const recorder = activeRecorders.get(page);
  if (recorder) {
    await recorder.stop();
    activeRecorders.delete(page);
  }
}
