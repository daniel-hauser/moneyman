import { readFile } from "node:fs/promises";
import sharp from "sharp";

export interface ScreenshotData {
  dataUrl: string;
  sizeBytes: number;
}

export async function createScreenshotDataUrl(
  photoPath: string,
): Promise<ScreenshotData> {
  const png = await readFile(photoPath);
  const webp = await sharp(png)
    .webp({ lossless: true, exact: true })
    .toBuffer();
  const original = `data:image/png;base64,${png.toString("base64")}`;
  const compressed = `data:image/webp;base64,${webp.toString("base64")}`;
  return compressed.length < original.length
    ? { dataUrl: compressed, sizeBytes: webp.length }
    : { dataUrl: original, sizeBytes: png.length };
}
