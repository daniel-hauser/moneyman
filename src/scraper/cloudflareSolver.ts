import { Page } from "puppeteer";
import { createLogger } from "../utils/logger.js";
import { sleep } from "../utils/utils.js";

const logger = createLogger("cloudflare-solver");

type Point = [number, number];

function* getMousePath(from: Point, to: Point): Generator<Point> {
  let [x, y] = from;
  const [x2, y2] = to;

  while (Math.abs(x - x2) > 3 || Math.abs(y - y2) > 3) {
    const diff = Math.abs(x - x2) + Math.abs(y - y2);
    let speed = Math.random() * 2 + 1;

    if (diff < 20) {
      speed = Math.random() * 3 + 1;
    } else {
      speed *= diff / 45;
    }

    if (Math.abs(x - x2) > 3) {
      x += x < x2 ? speed : -speed;
    }
    if (Math.abs(y - y2) > 3) {
      y += y < y2 ? speed : -speed;
    }

    yield [x, y];
  }
}

async function moveTo(page: Page, from: Point, to: Point): Promise<Point> {
  logger("Moving mouse from", from, "to", to);
  for (const [px, py] of getMousePath(from, to)) {
    await page.mouse.move(px, py);
    if (Math.random() * 100 > 15) {
      await sleep(Math.random() * 500 + 100);
    }
  }
  return to;
}

async function solveInvisible(
  page: Page,
  currentPosition: Point,
  windowWidth: number,
  windowHeight: number,
): Promise<string> {
  for (let i = 0; i < 10; i++) {
    logger("solveInvisible - Attempt", i + 1);
    currentPosition = await moveTo(page, currentPosition, [
      Math.random() * windowWidth,
      Math.random() * windowHeight,
    ]);

    const elem = await page.$("[name=cf-turnstile-response]");
    if (elem) {
      const value = await elem.evaluate((el) => el.getAttribute("value"));
      if (value) {
        logger("solveInvisible - Found value", value);
        return value;
      }
    }

    await sleep(Math.random() * 500 + 200);
  }

  return "failed to get cf-turnstile-response";
}

async function solveVisible(
  page: Page,
  currentPosition: Point,
  windowWidth: number,
  windowHeight: number,
): Promise<string> {
  try {
    const iframe = await page.waitForSelector("iframe", { timeout: 10000 });
    if (!iframe) return "iframe not found";
    const boundingBox = await iframe.boundingBox();
    if (!boundingBox) return "iframe bounding box not found";

    currentPosition = await moveTo(page, currentPosition, [
      boundingBox.x + Math.random() * 12 + 5,
      boundingBox.y + Math.random() * 12 + 5,
    ]);

    const frame = await iframe.contentFrame();
    if (!frame) return "frame not found";

    const checkbox = await frame.$("input");
    if (!checkbox) return "checkbox not found";

    const checkboxBox = await checkbox.boundingBox();
    if (!checkboxBox) return "checkbox bounding box not found";

    const { x, y, width, height } = checkboxBox;
    currentPosition = await moveTo(page, currentPosition, [
      x + width / 5 + Math.random() * (width - width / 5),
      y + height / 5 + Math.random() * (height - height / 5),
    ]);
    await page.mouse.click(...currentPosition);
    await sleep(500);
    return await solveInvisible(
      page,
      currentPosition,
      windowWidth,
      windowHeight,
    );
  } catch (error) {
    console.error("Timeout waiting for iframe:", error);
    return "failed";
  }
}

export async function solveTurnstile(
  page: Page,
  invisible: boolean = false,
): Promise<string> {
  const windowWidth = await page.evaluate(() => window.innerWidth);
  const windowHeight = await page.evaluate(() => window.innerHeight);
  logger("Window size", { windowWidth, windowHeight });
  return invisible
    ? solveInvisible(page, [0, 0], windowWidth, windowHeight)
    : solveVisible(page, [0, 0], windowWidth, windowHeight);
}
