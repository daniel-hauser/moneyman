import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  failureScreenShotFolder,
  getFailureScreenShotPath,
  sendFailureScreenShots,
} from "./failureScreenshot.js";

const tempFolder = path.join(fs.realpathSync(os.tmpdir()), "moneyman");

/** Write the file a screenshot path points at, so the glob in sendFailureScreenShots finds it. */
function touch(screenshotPath: string) {
  fs.writeFileSync(screenshotPath, "");
}

afterEach(() => {
  fs.rmSync(tempFolder, { recursive: true, force: true });
});

describe("failure screenshots", () => {
  it("gives two logins of one provider their own folder and caption", async () => {
    const home = getFailureScreenShotPath("isracard · home-bank");
    const cards = getFailureScreenShotPath("isracard · cards");
    expect(home).not.toEqual(cards);
    expect(path.basename(path.dirname(home))).toBe("isracard · home-bank");
    expect(path.basename(path.dirname(cards))).toBe("isracard · cards");

    touch(home);
    touch(cards);
    const captions: string[] = [];
    await sendFailureScreenShots(async (photos) => {
      captions.push(...photos.map(({ caption }) => caption));
    });
    expect(captions.sort()).toEqual([
      "[isracard · cards] Failure screenshot",
      "[isracard · home-bank] Failure screenshot",
    ]);
  });

  it("keeps the provider folder for a login with no scrapeId", () => {
    const screenshotPath = getFailureScreenShotPath("hapoalim");
    expect(path.basename(path.dirname(screenshotPath))).toBe("hapoalim");
    expect(screenshotPath.startsWith(tempFolder + path.sep)).toBe(true);
  });

  it("never builds a folder outside the temp folder from a label", () => {
    const escaped = getFailureScreenShotPath("hapoalim · ../../etc");
    expect(path.basename(path.dirname(escaped))).toBe("hapoalim · ....etc");
    expect(path.dirname(escaped).startsWith(tempFolder + path.sep)).toBe(true);
    expect(path.dirname(escaped)).not.toContain(".." + path.sep);

    expect(failureScreenShotFolder(".")).toBe("unknown-login");
    expect(failureScreenShotFolder("..")).toBe("unknown-login");
    expect(failureScreenShotFolder("/")).toBe("unknown-login");
    expect(failureScreenShotFolder("hapoalim · /")).toBe("hapoalim ·");
    expect(failureScreenShotFolder("hapoalim · \u0000")).toBe("hapoalim ·");
  });

  it("keeps long labels apart within the filename limit", () => {
    const prefix = "x".repeat(200);
    const first = failureScreenShotFolder(`hapoalim · ${prefix}a`);
    const second = failureScreenShotFolder(`hapoalim · ${prefix}b`);
    expect(Array.from(first)).toHaveLength(80);
    expect(first.startsWith("hapoalim · ")).toBe(true);
    expect(first).not.toEqual(second);
  });

  it("sends every screenshot and removes the temp folder afterwards", async () => {
    touch(getFailureScreenShotPath("isracard · home-bank"));
    touch(getFailureScreenShotPath("max"));
    const sent: string[] = [];
    await sendFailureScreenShots(async (photos) => {
      sent.push(...photos.map(({ photoPath }) => path.basename(photoPath)));
    });
    expect(sent).toHaveLength(2);
    expect(fs.existsSync(tempFolder)).toBe(false);
  });
});
