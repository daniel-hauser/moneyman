import { Page } from "puppeteer";
import { createLogger, logToMetadataFile } from "../utils/logger.js";
import { sleep } from "../utils/utils.js";
import { type Point, moveTo } from "./mouse.js";

const logger = createLogger("cloudflare-solver");

const containerLocation = { x: 506, y: 257 };
const checkboxBox = { x: 522, y: 280, width: 20, height: 20 };

export async function solveTurnstile(page: Page): Promise<string> {
  try {
    const windowWidth = await page.evaluate(() => window.innerWidth);
    const windowHeight = await page.evaluate(() => window.innerHeight);
    logger("Window size", { windowWidth, windowHeight });
    logToMetadataFile("Solving turnstile");

    page.on("close", () => {
      logToMetadataFile("Page closed");
    });

    let currentPosition: Point = [0, 0];
    currentPosition = await moveTo(page, currentPosition, [
      containerLocation.x + Math.random() * 12 + 5,
      containerLocation.y + Math.random() * 12 + 5,
    ]);

    logToMetadataFile("Mouse moved to random position");
    await sleep(1500);

    const { x, y, width, height } = checkboxBox;
    currentPosition = await moveTo(page, currentPosition, [
      x + width / 5 + Math.random() * (width - width / 5),
      y + height / 5 + Math.random() * (height - height / 5),
    ]);

    await page.mouse.click(...currentPosition);
    logToMetadataFile("Clicked on checkbox");
    await page.waitForNavigation({ timeout: 60_000 });
    return "success";
  } catch (error) {
    logger("solveTurnstile error", error);
    return "failed to solve: " + error;
  }
}
