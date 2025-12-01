import type { Page } from "puppeteer";
import type { CompanyTypes } from "israeli-bank-scrapers";
import { createLogger } from "../utils/logger.js";
import { join, basename } from "path";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";

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

export interface HarExportOptions {
  /** Directory path to save HAR files */
  exportPath?: string;
  /** Whether to send HAR files to Telegram */
  sendToTelegram?: boolean;
}

// Store active HAR recorders to stop them later
const activeRecorders = new Map<Page, HarRecorder>();

/**
 * Creates a preparePage function that starts HAR recording on page creation.
 * @param companyId The company ID for naming the HAR file
 * @param options HAR export options
 * @returns A function to be passed to the scraper's preparePage option
 */
export function createHarPreparePage(
  companyId: CompanyTypes,
  options: HarExportOptions,
): ((page: Page) => Promise<void>) | undefined {
  const { exportPath, sendToTelegram } = options;

  // Return undefined if neither option is enabled
  if (!exportPath && !sendToTelegram) {
    return undefined;
  }

  // Ensure the export directory exists if path is specified
  if (exportPath && !existsSync(exportPath)) {
    logger("Creating HAR export directory: %s", exportPath);
    mkdirSync(exportPath, { recursive: true });
  }

  return async (page: Page) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${companyId}-${timestamp}.har`;

    // Determine the file path - use exportPath if provided, otherwise use temp directory
    const harFilePath = exportPath
      ? join(exportPath, filename)
      : join(tmpdir(), filename);

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

        // Send to Telegram if enabled
        if (sendToTelegram) {
          try {
            await sendHarToTelegram(harFilePath, companyId);

            // Clean up temp file if we're only sending to Telegram (no export path)
            if (!exportPath) {
              logger("Cleaning up temporary HAR file: %s", harFilePath);
              unlinkSync(harFilePath);
            }
          } catch (e) {
            logger("Error sending HAR file to Telegram: %o", e);
          }
        }
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
 * Sends a HAR file to the Telegram chat.
 * @param harFilePath Path to the HAR file
 * @param companyId The company ID for the caption
 */
async function sendHarToTelegram(
  harFilePath: string,
  companyId: CompanyTypes,
): Promise<void> {
  // Dynamic import to avoid circular dependencies
  const { sendDocument } = await import("../bot/notifier.js");

  const harContent = readFileSync(harFilePath);
  const filename = basename(harFilePath) || `${companyId}.har`;

  logger("Sending HAR file to Telegram: %s", filename);
  await sendDocument(harContent, filename, `HAR file for ${companyId}`);
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
