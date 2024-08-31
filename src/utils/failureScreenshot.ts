import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { glob } from "glob";
import { createLogger } from "./logger.js";
import { sendPhoto } from "../notifier.js";

const logger = createLogger("failureScreenshot");
const tempFolder = path.join(fs.realpathSync(os.tmpdir()), "moneyman");

export function getFailureScreenShotPath(companyId: string) {
  const companyDir = path.join(tempFolder, companyId);
  if (!fs.existsSync(companyDir)) {
    fs.mkdirSync(companyDir, { recursive: true });
  }

  const filePath = path.join(companyDir, `${companyId}-${Date.now()}.png`);
  logger("getFailureScreenShotPath", { filePath });

  return filePath;
}

export async function sendFailureScreenShots() {
  try {
    const files = await glob(`${tempFolder}/**/*.png`, { absolute: true });
    logger("Sending failure screenshots", { files });

    for (const file of files) {
      const folder = path.basename(path.dirname(file));
      await sendPhoto(file, `[${folder}] Failure screenshot`);
    }

    fs.rmSync(tempFolder, { recursive: true, force: true });
  } catch (e) {
    logger("Failed to send failure screenshots", e);
  }
}
