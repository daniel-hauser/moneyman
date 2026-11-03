import sharp from "sharp";

export async function createScreenshotDataUrl(png: Buffer): Promise<string> {
  const webp = await sharp(png)
    .webp({ lossless: true, exact: true })
    .toBuffer();
  const original = `data:image/png;base64,${png.toString("base64")}`;
  const compressed = `data:image/webp;base64,${webp.toString("base64")}`;
  return compressed.length < original.length ? compressed : original;
}
