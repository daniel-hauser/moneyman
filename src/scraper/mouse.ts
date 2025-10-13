import { Page } from "puppeteer";
import { createLogger } from "../utils/logger.js";
import { sleep } from "../utils/utils.js";

const logger = createLogger("mouse");

export type Point = [number, number];

export function* getMousePath(from: Point, to: Point): Generator<Point> {
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

export async function moveTo(
  page: Page,
  from: Point,
  to: Point,
): Promise<Point> {
  logger("Moving mouse from", from, "to", to);
  for (const [px, py] of getMousePath(from, to)) {
    if (page.isClosed()) {
      throw new Error("Page is closed");
    }
    await page.mouse.move(px, py);
    if (Math.random() * 100 > 15) {
      await sleep(Math.random() * 500 + 100);
    }
  }
  return to;
}

export async function randomPoint(page: Page): Promise<Point> {
  const viewport =
    page.viewport() ??
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })));
  return [
    Math.floor(Math.random() * viewport.width),
    Math.floor(Math.random() * viewport.height),
  ];
}
