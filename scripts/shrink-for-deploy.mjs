/** Emits small deploy variants: deploy/logo.b64 (240w) + deploy/icon.b64 (128px). */
import fs from "node:fs";
import { PNG } from "pngjs";

function scale(png, tw, th) {
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

function emit(srcPath, tw, outName) {
  const src = PNG.sync.read(fs.readFileSync(srcPath));
  const th = Math.round((src.height / src.width) * tw);
  const out = scale(src, tw, th);
  const buf = PNG.sync.write(out);
  const b64 = buf.toString("base64").replace(/(.{100})/g, "$1\n");
  fs.writeFileSync(`deploy/${outName}`, b64);
  console.log(`${outName}: ${tw}x${th}, ${buf.length} bytes, ${b64.length} b64 chars`);
}

emit("public/logo.png", 240, "logo.b64");
emit("src/app/icon.png", 128, "icon.b64");
