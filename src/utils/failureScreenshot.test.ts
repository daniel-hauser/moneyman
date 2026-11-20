import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  failureScreenShotFolder,
  getFailureScreenShotPath,
  sendFailureScreenShots,
} from "./failureScreenshot.js";

const tempFolder = path.join(fs.realpathSync(os.tmpdir()), "moneyman");
/** One path component holds at most 255 UTF-8 bytes, and the file adds "-<13-digit timestamp>.png". */
const MAX_COMPONENT_BYTES = 255;
const FILE_SUFFIX_BYTES = 18;

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
    expect(path.basename(path.dirname(escaped))).toMatch(
      /^hapoalim · \.\.\.\.etc-[A-Za-z0-9_-]{8}$/,
    );
    expect(path.dirname(escaped).startsWith(tempFolder + path.sep)).toBe(true);
    expect(path.dirname(escaped)).not.toContain(".." + path.sep);

    expect(failureScreenShotFolder(".")).toMatch(
      /^unknown-login-[A-Za-z0-9_-]{8}$/,
    );
    expect(failureScreenShotFolder("..")).not.toEqual(
      failureScreenShotFolder("."),
    );
    expect(failureScreenShotFolder("/")).toMatch(
      /^unknown-login-[A-Za-z0-9_-]{8}$/,
    );
    expect(failureScreenShotFolder("hapoalim · /")).toMatch(
      /^hapoalim ·-[A-Za-z0-9_-]{8}$/,
    );
    expect(failureScreenShotFolder("hapoalim · \u0000")).toMatch(
      /^hapoalim ·-[A-Za-z0-9_-]{8}$/,
    );
  });

  it("keeps a sanitized label apart from the label it collapses into", () => {
    const collapsed = failureScreenShotFolder("hapoalim · home/bank");
    const literal = failureScreenShotFolder("hapoalim · homebank");
    expect(collapsed).not.toEqual(literal);
    expect(literal).toBe("hapoalim · homebank");
    expect(collapsed).toMatch(/^hapoalim · homebank-[A-Za-z0-9_-]{8}$/);
  });

  it("bounds folder names in UTF-8 bytes and keeps multi-byte labels apart", () => {
    const long = "😀".repeat(80);
    const first = failureScreenShotFolder(`hapoalim · ${long}a`);
    const second = failureScreenShotFolder(`hapoalim · ${long}b`);
    expect(
      Buffer.byteLength(first, "utf8") + FILE_SUFFIX_BYTES,
    ).toBeLessThanOrEqual(MAX_COMPONENT_BYTES);
    expect(first.startsWith("hapoalim · ")).toBe(true);
    expect(first).not.toEqual(second);

    // The path the scraper is handed keeps the whole file name inside the limit.
    const screenshotPath = getFailureScreenShotPath(`hapoalim · ${long}a`);
    expect(
      Buffer.byteLength(path.basename(screenshotPath), "utf8"),
    ).toBeLessThanOrEqual(MAX_COMPONENT_BYTES);
    expect(fs.existsSync(path.dirname(screenshotPath))).toBe(true);
  });

  it("keeps long ASCII labels apart within the byte limit", () => {
    const prefix = "x".repeat(300);
    const first = failureScreenShotFolder(`hapoalim · ${prefix}a`);
    const second = failureScreenShotFolder(`hapoalim · ${prefix}b`);
    expect(Buffer.byteLength(first, "utf8")).toBe(
      MAX_COMPONENT_BYTES - FILE_SUFFIX_BYTES,
    );
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
