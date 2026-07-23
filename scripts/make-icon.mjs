// Composite assets/icon-source.png onto a macOS-style rounded-square background
// at each required size, then assemble a .icns via iconutil.
// Uses Playwright's bundled Chromium for canvas compositing — no ImageMagick dep.

import { chromium } from 'playwright';
import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '..');
const srcPath = path.join(repo, 'assets/icon-source.png');
const outDir = path.join(repo, 'build');
const iconset = path.join(outDir, 'AppIcon.iconset');

// macOS Big Sur+ icon geometry: the rounded square sits inset on a transparent
// canvas (Apple's template is ~824/1024 — that margin is why stock icons look
// smaller than a full-bleed one), corner radius ~22.37% of the square side.
const SQUARE_SCALE = 824 / 1024;
const CORNER_RADIUS_RATIO = 0.2237;
const GLYPH_SCALE = 0.72; // glyph occupies 72% of the rounded square
const BG_COLOR = '#f1ecdf'; // paper theme background (see src/styles.css)
const INK_COLOR = [0x1c, 0x19, 0x17]; // glyph ink, matches the theme --fg

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))
    );
  });
}

const sizes = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];

await rm(outDir, { recursive: true, force: true });
await mkdir(iconset, { recursive: true });

const srcB64 = (await readFile(srcPath)).toString('base64');
const dataUrl = `data:image/png;base64,${srcB64}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const page = await ctx.newPage();

for (const [size, name] of sizes) {
  const bytes = await page.evaluate(
    async ({ size, dataUrl, squareScale, radiusRatio, glyphScale, bg, ink }) => {
      const img = new Image();
      img.src = dataUrl;
      await new Promise((r) => (img.onload = r));

      // The source glyph is black-on-white with the white baked in. Recover a
      // transparent glyph by mapping luminance to alpha (white → transparent,
      // black → ink) — antialiased edges become semi-transparent ink, so
      // there's no white fringing on the paper background.
      const glyph = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const gg = glyph.getContext('2d');
      gg.drawImage(img, 0, 0);
      const data = gg.getImageData(0, 0, glyph.width, glyph.height);
      const px = data.data;
      // Ramp with thresholds rather than a straight 1-luma map: the PNG's
      // "white" carries compression noise (luma 245–254) that would otherwise
      // leave a ghost of the original square at ~2% alpha.
      const T_WHITE = 240; // at/above: fully transparent
      const T_BLACK = 128; // at/below: fully opaque
      for (let i = 0; i < px.length; i += 4) {
        const luma = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
        const f = Math.min(1, Math.max(0, (T_WHITE - luma) / (T_WHITE - T_BLACK)));
        px[i + 3] = Math.round(px[i + 3] * f);
        px[i] = ink[0];
        px[i + 1] = ink[1];
        px[i + 2] = ink[2];
      }
      gg.putImageData(data, 0, 0);

      const canvas = new OffscreenCanvas(size, size);
      const g = canvas.getContext('2d');
      const side = size * squareScale;
      const o = (size - side) / 2; // transparent margin around the square
      const r = side * radiusRatio;

      // Rounded-rect clip + fill, inset on the transparent canvas.
      g.beginPath();
      g.moveTo(o + r, o);
      g.lineTo(o + side - r, o);
      g.quadraticCurveTo(o + side, o, o + side, o + r);
      g.lineTo(o + side, o + side - r);
      g.quadraticCurveTo(o + side, o + side, o + side - r, o + side);
      g.lineTo(o + r, o + side);
      g.quadraticCurveTo(o, o + side, o, o + side - r);
      g.lineTo(o, o + r);
      g.quadraticCurveTo(o, o, o + r, o);
      g.closePath();
      g.fillStyle = bg;
      g.fill();
      g.clip();

      // Draw glyph centered, scaled to preserve aspect ratio, at `glyphScale` of the square.
      const maxGlyph = side * glyphScale;
      const scale = Math.min(maxGlyph / glyph.width, maxGlyph / glyph.height);
      const w = glyph.width * scale;
      const h = glyph.height * scale;
      g.drawImage(glyph, (size - w) / 2, (size - h) / 2, w, h);

      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const ab = await blob.arrayBuffer();
      return Array.from(new Uint8Array(ab));
    },
    {
      size,
      dataUrl,
      squareScale: SQUARE_SCALE,
      radiusRatio: CORNER_RADIUS_RATIO,
      glyphScale: GLYPH_SCALE,
      bg: BG_COLOR,
      ink: INK_COLOR,
    }
  );
  await writeFile(path.join(iconset, name), Buffer.from(bytes));
  console.log('wrote', name, `${size}x${size}`);
}

await browser.close();

await run('iconutil', ['-c', 'icns', iconset, '-o', path.join(outDir, 'icon.icns')]);
await copyFile(path.join(iconset, 'icon_512x512.png'), path.join(outDir, 'icon.png'));

console.log('✓ wrote build/icon.icns and build/icon.png');
