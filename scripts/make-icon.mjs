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

// macOS Big Sur+ icon geometry: rounded-square background, glyph inset.
// Corner radius is roughly 22.37% of the icon side; Apple's template uses ~824/1024 content area.
const CORNER_RADIUS_RATIO = 0.2237;
const GLYPH_SCALE = 0.72; // glyph occupies 72% of the canvas; rest is margin
const BG_COLOR = '#ffffff';

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
    async ({ size, dataUrl, radiusRatio, glyphScale, bg }) => {
      const img = new Image();
      img.src = dataUrl;
      await new Promise((r) => (img.onload = r));

      const canvas = new OffscreenCanvas(size, size);
      const g = canvas.getContext('2d');
      const r = size * radiusRatio;

      // Rounded-rect clip + fill.
      g.beginPath();
      g.moveTo(r, 0);
      g.lineTo(size - r, 0);
      g.quadraticCurveTo(size, 0, size, r);
      g.lineTo(size, size - r);
      g.quadraticCurveTo(size, size, size - r, size);
      g.lineTo(r, size);
      g.quadraticCurveTo(0, size, 0, size - r);
      g.lineTo(0, r);
      g.quadraticCurveTo(0, 0, r, 0);
      g.closePath();
      g.fillStyle = bg;
      g.fill();
      g.clip();

      // Draw glyph centered, scaled to preserve aspect ratio, at `glyphScale` of the canvas.
      const maxGlyph = size * glyphScale;
      const scale = Math.min(maxGlyph / img.naturalWidth, maxGlyph / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const ab = await blob.arrayBuffer();
      return Array.from(new Uint8Array(ab));
    },
    { size, dataUrl, radiusRatio: CORNER_RADIUS_RATIO, glyphScale: GLYPH_SCALE, bg: BG_COLOR }
  );
  await writeFile(path.join(iconset, name), Buffer.from(bytes));
  console.log('wrote', name, `${size}x${size}`);
}

await browser.close();

await run('iconutil', ['-c', 'icns', iconset, '-o', path.join(outDir, 'icon.icns')]);
await copyFile(path.join(iconset, 'icon_512x512.png'), path.join(outDir, 'icon.png'));

console.log('✓ wrote build/icon.icns and build/icon.png');
