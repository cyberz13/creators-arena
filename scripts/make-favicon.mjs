/**
 * Rebuilds src/app/favicon.ico from src/app/icon.png (the CA logo):
 * PNG-in-ICO entries at 16/32/48/256 px, box-filter downscaling, pure JS.
 *   node scripts/make-favicon.mjs
 */
import fs from "node:fs";
import { PNG } from "pngjs";

const src = PNG.sync.read(fs.readFileSync("src/app/icon.png"));
if (src.width !== src.height) {
  console.error(`icon.png must be square (got ${src.width}x${src.height})`);
  process.exit(1);
}

/** Area-average downscale (any ratio). */
function downscale(img, size) {
  const scale = img.width / size;
  const out = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * scale), x1 = Math.min(img.width, Math.ceil((x + 1) * scale));
      const y0 = Math.floor(y * scale), y1 = Math.min(img.height, Math.ceil((y + 1) * scale));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * img.width + sx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; a += img.data[i + 3];
          n++;
        }
      }
      const o = (y * size + x) * 4;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

const sizes = [16, 32, 48, 256];
const pngs = sizes.map((s) => ({
  size: s,
  buf: PNG.sync.write(s === src.width ? src : downscale(src, s)),
}));

// ICO: 6-byte header, 16-byte directory entry per image, then PNG blobs.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + 16 * pngs.length;
const entries = [];
for (const { size, buf } of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(size === 256 ? 0 : size, 0); // width (0 = 256)
  e.writeUInt8(size === 256 ? 0 : size, 1); // height
  e.writeUInt8(0, 2); // palette
  e.writeUInt8(0, 3); // reserved
  e.writeUInt16LE(1, 4); // planes
  e.writeUInt16LE(32, 6); // bpp
  e.writeUInt32LE(buf.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += buf.length;
  entries.push(e);
}

const ico = Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
fs.writeFileSync("src/app/favicon.ico", ico);
console.log(`✅ favicon.ico: ${sizes.join("/")}px, ${ico.length} bytes`);
