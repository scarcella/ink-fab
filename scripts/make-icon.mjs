// Rasterize assets/logo.svg (which carries its own paper squircle background)
// at each required size, then assemble a .icns via iconutil.
// Uses Playwright's bundled Chromium for canvas compositing — no ImageMagick dep.

import { chromium } from 'playwright';
import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '..');
const srcPath = path.join(repo, 'assets/logo.svg');
const outDir = path.join(repo, 'build');
const iconset = path.join(outDir, 'AppIcon.iconset');

// macOS Big Sur+ icon geometry: the artwork sits inset on a transparent canvas
// (Apple's template is ~824/1024 — that margin is why stock icons look smaller
// than a full-bleed one). The SVG supplies its own squircle and corner radius.
const SQUARE_SCALE = 824 / 1024;

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
const dataUrl = `data:image/svg+xml;base64,${srcB64}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ deviceScaleFactor: 1 });
const page = await ctx.newPage();

for (const [size, name] of sizes) {
  const bytes = await page.evaluate(
    async ({ size, dataUrl, squareScale }) => {
      const img = new Image();
      img.src = dataUrl;
      await new Promise((r) => (img.onload = r));

      const canvas = new OffscreenCanvas(size, size);
      const g = canvas.getContext('2d');
      const side = size * squareScale;
      const o = (size - side) / 2; // transparent margin around the artwork

      g.drawImage(img, o, o, side, side);

      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const ab = await blob.arrayBuffer();
      return Array.from(new Uint8Array(ab));
    },
    { size, dataUrl, squareScale: SQUARE_SCALE }
  );
  await writeFile(path.join(iconset, name), Buffer.from(bytes));
  console.log('wrote', name, `${size}x${size}`);
}

await browser.close();

await run('iconutil', ['-c', 'icns', iconset, '-o', path.join(outDir, 'icon.icns')]);
await copyFile(path.join(iconset, 'icon_512x512.png'), path.join(outDir, 'icon.png'));

console.log('✓ wrote build/icon.icns and build/icon.png');
