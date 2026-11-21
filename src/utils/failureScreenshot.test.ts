import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getFailureScreenShotPath,
  sendFailureScreenShots,
} from "./failureScreenshot.js";
import type { ImageWithCaption } from "../types.js";

jest.mock("node:os", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { randomUUID } = require("node:crypto");
  const root = path.join(process.cwd(), `.screenshot-test-${randomUUID()}`);
  fs.mkdirSync(root);
  return { ...jest.requireActual("node:os"), tmpdir: () => root };
});

const root = os.tmpdir();
const tempFolder = path.join(root, "moneyman");

afterEach(() => {
  fs.rmSync(tempFolder, { recursive: true, force: true });
  jest.restoreAllMocks();
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("failure screenshots", () => {
  it("keeps login labels distinct in folders and captions and removes sent files", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1234567890123);
    const home = getFailureScreenShotPath("isracard · home-bank");
    const homeAgain = getFailureScreenShotPath("isracard · home-bank");
    const cards = getFailureScreenShotPath("isracard · cards");
    const unnamed = getFailureScreenShotPath("hapoalim");
    expect(home).not.toBe(homeAgain);
    expect(path.basename(home)).toBe("1234567890123.png");
    expect(path.basename(homeAgain)).toBe("1234567890123.png");
    expect(path.basename(path.dirname(path.dirname(home)))).toBe(
      "isracard · home-bank",
    );
    expect(path.dirname(path.dirname(home))).toBe(
      path.dirname(path.dirname(homeAgain)),
    );
    [home, homeAgain, cards, unnamed].forEach((file) =>
      fs.writeFileSync(file, ""),
    );

    const send = jest.fn(async (_photos: ImageWithCaption[]) => {});
    await sendFailureScreenShots(send);
    expect(
      send.mock.calls[0][0].map(({ photoPath }) => photoPath).sort(),
    ).toEqual([home, homeAgain, cards, unnamed].sort());
    expect(send.mock.calls[0][0].map(({ caption }) => caption).sort()).toEqual([
      "[hapoalim] Failure screenshot",
      "[isracard · cards] Failure screenshot",
      "[isracard · home-bank] Failure screenshot",
      "[isracard · home-bank] Failure screenshot",
    ]);
    expect(fs.existsSync(tempFolder)).toBe(false);
  });

  it("keeps an unsafe label inside the screenshot folder", async () => {
    const file = getFailureScreenShotPath("hapoalim · ../../etc");
    const accountDir = path.dirname(path.dirname(file));
    expect(path.dirname(accountDir)).toBe(tempFolder);
    expect(path.basename(accountDir)).toBe("hapoalim · .._.._etc");
    expect(
      path.basename(path.dirname(path.dirname(getFailureScreenShotPath("..")))),
    ).toBe("_");
    expect(
      path.dirname(
        path.dirname(getFailureScreenShotPath("hapoalim · home/cards")),
      ),
    ).not.toBe(
      path.dirname(
        path.dirname(getFailureScreenShotPath("hapoalim · homecards")),
      ),
    );
    fs.writeFileSync(file, "");
    const send = jest.fn(async (_photos: ImageWithCaption[]) => {});
    await sendFailureScreenShots(send);
    expect(send.mock.calls[0][0][0].caption).toBe(
      "[hapoalim · .._.._etc] Failure screenshot",
    );
  });
});
