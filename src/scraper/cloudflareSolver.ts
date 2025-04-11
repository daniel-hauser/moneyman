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

const containerLocation = { x: 506, y: 257 };
const checkboxBox = { x: 522, y: 280, width: 20, height: 20 };

async function solveVisible(
  page: Page,
  currentPosition: Point = [0, 0],
): Promise<string> {
  try {
    currentPosition = await moveTo(page, currentPosition, [
      containerLocation.x + Math.random() * 12 + 5,
      containerLocation.y + Math.random() * 12 + 5,
    ]);

    logger("Moving");
    await sleep(1200);

    const { x, y, width, height } = checkboxBox;
    currentPosition = await moveTo(page, currentPosition, [
      x + width / 5 + Math.random() * (width - width / 5),
      y + height / 5 + Math.random() * (height - height / 5),
    ]);

    await page.mouse.click(...currentPosition);
    logger("Clicked");
    await page.waitForNavigation({ timeout: 5000 });
    return "success";
  } catch (error) {
    logger("solveVisible error", error);
    return "failed to find the iframe";
  }
}

export async function solveTurnstile(page: Page): Promise<string> {
  const windowWidth = await page.evaluate(() => window.innerWidth);
  const windowHeight = await page.evaluate(() => window.innerHeight);
  logger("Window size", { windowWidth, windowHeight });

  logger("Moving mouse");
  await moveTo(
    page,
    [windowWidth / 2, windowHeight / 2],
    [Math.random() * windowWidth, Math.random() * windowHeight],
  );
  return solveVisible(page, [0, 0]);
}
