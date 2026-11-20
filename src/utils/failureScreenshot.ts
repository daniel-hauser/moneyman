import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { glob } from "glob";
import { createLogger } from "./logger.js";
import { sha256 } from "./utils.js";
import type { ImageWithCaption } from "../types.js";

const logger = createLogger("failureScreenshot");
const tempFolder = path.join(fs.realpathSync(os.tmpdir()), "moneyman");

/** Longest folder name built from a label; a longer one keeps a prefix and a digest. */
const MAX_FOLDER_CHARS = 80;
/** Folder for a label that holds nothing usable as a name. */
const UNNAMED_FOLDER = "unknown-login";

/**
 * Turn a login's label into the folder holding its failure screenshots.
 *
 * The label is configuration data, so it is not trusted as a path: separators and
 * control characters are dropped, because a scrapeId holding a `/` would otherwise
 * nest folders or climb out of the temp folder. A label too long for a filename keeps
 * a readable prefix plus a digest of the whole label, so two long labels cannot share
 * one folder. A label that is empty or only dots falls back to a fixed name.
 */
export function failureScreenShotFolder(label: string): string {
  const safe = label.replace(/[\\/\u0000-\u001f\u007f]/g, "").trim();
  if (safe === "" || /^\.+$/.test(safe)) return UNNAMED_FOLDER;
  const characters = Array.from(safe);
  if (characters.length <= MAX_FOLDER_CHARS) return safe;
  const digest = sha256(safe, "base64url").slice(0, 8);
  return `${characters.slice(0, MAX_FOLDER_CHARS - digest.length - 1).join("")}-${digest}`;
}

/**
 * Path for the screenshot of a failed login, keyed by its label
 * (`scrapeLabel(account)`, so `companyId · scrapeId`).
 *
 * Two logins of one provider get their own folder, their own file and their own
 * caption instead of sharing one indistinguishable pair; a login with no scrapeId
 * keeps the provider name it had before. `sendFailureScreenShots` builds the caption
 * from this folder name.
 */
export function getFailureScreenShotPath(label: string) {
  const accountDir = path.join(tempFolder, failureScreenShotFolder(label));
  if (!fs.existsSync(accountDir)) {
    fs.mkdirSync(accountDir, { recursive: true });
  }

  const filePath = path.join(
    accountDir,
    `${path.basename(accountDir)}-${Date.now()}.png`,
  );
  logger("getFailureScreenShotPath %o", filePath);

  return filePath;
}

export async function sendFailureScreenShots(
  sendPhotos: (photos: Array<ImageWithCaption>) => Promise<unknown>,
) {
  try {
    const photos = await glob(`${tempFolder}/**/*.png`, { absolute: true });
    await sendPhotos(
      photos.map((photoPath) => ({
        photoPath,
        caption: `[${path.basename(path.dirname(photoPath))}] Failure screenshot`,
      })),
    );
    fs.rmSync(tempFolder, { recursive: true, force: true });
  } catch (e) {
    logger("Failed to collect failure screenshots", e);
  }
}
