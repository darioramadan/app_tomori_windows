// Renders the default creature into app-icon.png, the source of electron/icon.ico (any png→ico converter).
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { characters } from "../../site/src/domain/characters.ts";
import { rgbOf, spriteFrame } from "../../site/src/domain/sprite.ts";

const px = spriteFrame(characters[0]!, "#d97757", "idle", 1);
const rows = px.filter((r) => r.some(Boolean));
const top = px.findIndex((r) => r.some(Boolean));
const cols = px[0]!.map((_, x) => x).filter((x) => px.some((r) => r[x]));
const [x0, x1] = [cols[0]!, cols.at(-1)!];
const size = 512, scale = Math.floor((size * 0.8) / Math.max(rows.length, x1 - x0 + 1));
const w = (x1 - x0 + 1) * scale, h = rows.length * scale, ox = (size - w) >> 1, oy = (size - h) >> 1;
const buf = Buffer.alloc(size * (size * 4 + 1));
for (let y = 0; y < size; y++) {
  buf[y * (size * 4 + 1)] = 0;
  for (let x = 0; x < size; x++) {
    const sx = Math.floor((x - ox) / scale) + x0, sy = Math.floor((y - oy) / scale) + top;
    const c = x >= ox && y >= oy && x < ox + w && y < oy + h ? px[sy]?.[sx] : null;
    const o = y * (size * 4 + 1) + 1 + x * 4;
    if (c) { const [r, g, b] = rgbOf(c); buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255; }
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync("app-icon.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(buf)), chunk("IEND", Buffer.alloc(0))]));
