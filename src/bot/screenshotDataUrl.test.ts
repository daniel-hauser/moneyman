import sharp from "sharp";
import { createScreenshotDataUrl } from "./screenshotDataUrl.js";

describe("createScreenshotDataUrl", () => {
  it("reduces a synthetic text/UI screenshot without changing dimensions or pixels", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700">
      <rect width="1000" height="700" fill="#f3f5f8"/>
      <rect width="1000" height="70" fill="#203654"/>
      <text x="30" y="45" font-family="sans-serif" font-size="24" fill="white">Example dashboard</text>
      ${Array.from(
        { length: 12 },
        (
          _,
          i,
        ) => `<rect x="25" y="${90 + i * 45}" width="950" height="40" fill="${i % 2 ? "#ffffff" : "#e4e9f0"}"/>
          <text x="40" y="${117 + i * 45}" font-family="sans-serif" font-size="16" fill="#17283c">Sample row ${i + 1} — Status: ready — Value: ${i * 13}.00</text>`,
      ).join("")}
    </svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    const dataUrl = await createScreenshotDataUrl(png);
    const webp = Buffer.from(dataUrl.split(",")[1], "base64");

    expect(dataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(await sharp(webp).metadata()).toMatchObject({
      format: "webp",
      width: 1000,
      height: 700,
    });
    expect(await sharp(webp).ensureAlpha().raw().toBuffer()).toEqual(
      await sharp(png).ensureAlpha().raw().toBuffer(),
    );
    expect(webp.length).toBeLessThan(png.length * 0.8);
    expect(dataUrl.length).toBeLessThan(
      `data:image/png;base64,${png.toString("base64")}`.length,
    );
  });

  it("preserves alpha and RGB values, including fully transparent pixels", async () => {
    const pixels = Buffer.alloc(100 * 100 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 45;
      pixels[i + 1] = 90;
      pixels[i + 2] = 135;
      pixels[i + 3] = (i / 4) % 256;
    }
    const png = await sharp(pixels, {
      raw: { width: 100, height: 100, channels: 4 },
    })
      .png()
      .toBuffer();

    const dataUrl = await createScreenshotDataUrl(png);
    const webp = Buffer.from(dataUrl.split(",")[1], "base64");

    expect(dataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(await sharp(webp).metadata()).toMatchObject({
      width: 100,
      height: 100,
      hasAlpha: true,
    });
    expect(await sharp(webp).raw().toBuffer()).toEqual(pixels);
  });

  it("intentionally retains the exact original PNG when WebP would be larger", async () => {
    const pixels = Buffer.alloc(8 * 8 * 3);
    let state = 12345;
    for (let i = 0; i < pixels.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      pixels[i] = state >>> 24;
    }
    const png = await sharp(pixels, {
      raw: { width: 8, height: 8, channels: 3 },
    })
      .png()
      .toBuffer();
    const webp = await sharp(png)
      .webp({ lossless: true, exact: true })
      .toBuffer();
    expect(webp.length).toBeGreaterThan(png.length);

    expect(await createScreenshotDataUrl(png)).toBe(
      `data:image/png;base64,${png.toString("base64")}`,
    );
  });

  it("propagates encoding errors rather than silently embedding the original", async () => {
    await expect(
      createScreenshotDataUrl(Buffer.from("not an image")),
    ).rejects.toThrow();
  });
});
