import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { glob } from "glob";
import { createLogger } from "./logger.js";
import { sha256 } from "./utils.js";
import type { ImageWithCaption } from "../types.js";

const logger = createLogger("failureScreenshot");
const tempFolder = path.join(fs.realpathSync(os.tmpdir()), "moneyman");

/** Bytes a screenshot file appends to the folder name: `-`, a 13-digit timestamp and `.png`. */
const FILE_SUFFIX_BYTES = 18;
/** Longest folder name in UTF-8 bytes: one path component holds at most 255. */
const MAX_FOLDER_BYTES = 255 - FILE_SUFFIX_BYTES;
/** Base64url characters of the digest that keeps two similar labels apart. */
const DIGEST_CHARS = 8;
/** The suffix those characters are appended with, so a generated name is recognisable. */
const DIGEST_SUFFIX = new RegExp(`-[A-Za-z0-9_-]{${DIGEST_CHARS}}$`);
/** Folder for a label that holds nothing usable as a name. */
const UNNAMED_FOLDER = "unknown-login";

/** Cut a value to at most maxBytes UTF-8 bytes, never splitting a code point. */
function truncateToBytes(value: string, maxBytes: number): string {
  let bytes = 0;
  let truncated = "";
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    truncated += character;
  }
  return truncated;
}

/**
 * Whether a folder name has to carry a digest to stay unique to its label.
 *
 * True when the sanitizer changed the label, when the name already ends in a
 * generated-looking suffix (a hand-written label must not be able to occupy the
 * folder a generated name uses), and when the name is too long for a component.
 */
function needsDigest(label: string, named: string): boolean {
  return (
    named !== label ||
    DIGEST_SUFFIX.test(named) ||
    Buffer.byteLength(named, "utf8") > MAX_FOLDER_BYTES
  );
}

/**
 * Turn a login's label into the folder holding its failure screenshots.
 *
 * The label is configuration data, so it is not trusted as a path: separators and
 * control characters are dropped, because a scrapeId holding a `/` would otherwise
 * nest folders or climb out of the temp folder. A label the sanitizer changed, one
 * already shaped like a generated name, and one too long for a path component each
 * carry a digest of the original label, so no two labels can share a folder. Length is
 * measured in UTF-8 bytes, because a scrapeId may hold multi-byte characters, and the
 * file's own suffix is reserved so the folder and the file name both fit in one
 * component. A label that is empty or only dots falls back to a fixed name plus that
 * digest.
 */
export function failureScreenShotFolder(label: string): string {
  const safe = label.replace(/[\\/\u0000-\u001f\u007f]/g, "").trim();
  const named = safe === "" || /^\.+$/.test(safe) ? UNNAMED_FOLDER : safe;
  const digest = needsDigest(label, named)
    ? `-${sha256(label, "base64url").slice(0, DIGEST_CHARS)}`
    : "";
  const budget = MAX_FOLDER_BYTES - Buffer.byteLength(digest, "utf8");
  return `${truncateToBytes(named, budget)}${digest}`;
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
