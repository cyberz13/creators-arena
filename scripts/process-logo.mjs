/**
 * One-time asset prep: takes the official CA logo (black square PNG),
 * crops to the mark and turns the black background transparent, then
 * writes public/logo.png (header mark) and src/app/icon.png (favicon).
 * Pure JS (pngjs) — native image libs are blocked on this machine.
 */
import fs from "node:fs";
import { PNG } from "pngjs";

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) {
  console.error("usage: node scripts/process-logo.mjs <source.png>");
  process.exit(1);
}

const src = PNG.sync.read(fs.readFileSync(SRC));
const { width: W, height: H, data } = src;

// --- find the mark's bounding box (anything meaningfully brighter than black bg)
const lum = (i) => Math.max(data[i], data[i + 1], data[i + 2]);
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (lum(i) > 28) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
const pad = Math.round((maxX - minX) * 0.04);
minX = Math.max(0, minX - pad);
minY = Math.max(0, minY - pad);
maxX = Math.min(W - 1, maxX + pad);
maxY = Math.min(H - 1, maxY + pad);
const cw = maxX - minX + 1;
const ch = maxY - minY + 1;
console.log(`crop: ${cw}x${ch} at (${minX},${minY}) from ${W}x${H}`);

// --- crop + black → transparent (soft ramp keeps anti-aliased edges clean on dark UIs)
const out = new PNG({ width: cw, height: ch });
for (let y = 0; y < ch; y++) {
  for (let x = 0; x < cw; x++) {
    const si = ((y + minY) * W + (x + minX)) * 4;
    const di = (y * cw + x) * 4;
    const l = lum(si);
    let alpha = 255;
    if (l <= 20) alpha = 0;
    else if (l < 70) alpha = Math.round(((l - 20) / 50) * 255);
    out.data[di] = data[si];
    out.data[di + 1] = data[si + 1];
    out.data[di + 2] = data[si + 2];
    out.data[di + 3] = alpha;
  }
}

// --- downscale (box filter) for reasonable file sizes
function scale(png, tw) {
  const th = Math.round((png.height / png.width) * tw);
  const o = new PNG({ width: tw, height: th });
  const fx = png.width / tw, fy = png.height / th;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(x * fx), x1 = Math.min(png.width, Math.ceil((x + 1) * fx));
      const y0 = Math.floor(y * fy), y1 = Math.min(png.height, Math.ceil((y + 1) * fy));
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * png.width + sx) * 4;
          const w = png.data[i + 3] / 255;
          r += png.data[i] * w; g += png.data[i + 1] * w; b += png.data[i + 2] * w;
          a += png.data[i + 3]; n++;
        }
      }
      const di = (y * tw + x) * 4;
      const aw = a / 255 || 1;
      o.data[di] = Math.round(r / aw);
      o.data[di + 1] = Math.round(g / aw);
      o.data[di + 2] = Math.round(b / aw);
      o.data[di + 3] = Math.round(a / n);
    }
  }
  return o;
}

const mark = scale(out, 480);
fs.writeFileSync("public/logo.png", PNG.sync.write(mark));
console.log(`public/logo.png: ${mark.width}x${mark.height}`);

// --- favicon: original square (black bg kept, like the brand tile), downscaled
const icon = new PNG({ width: 256, height: 256 });
const f = W / 256;
for (let y = 0; y < 256; y++) {
  for (let x = 0; x < 256; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    const x0 = Math.floor(x * f), x1 = Math.min(W, Math.ceil((x + 1) * f));
    const y0 = Math.floor(y * f), y1 = Math.min(H, Math.ceil((y + 1) * f));
    for (let sy = y0; sy < y1; sy++) {
      for (let sx = x0; sx < x1; sx++) {
        const i = (sy * W + sx) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    const di = (y * 256 + x) * 4;
    icon.data[di] = Math.round(r / n);
    icon.data[di + 1] = Math.round(g / n);
    icon.data[di + 2] = Math.round(b / n);
    icon.data[di + 3] = 255;
  }
}
fs.writeFileSync("src/app/icon.png", PNG.sync.write(icon));
console.log("src/app/icon.png: 256x256");
