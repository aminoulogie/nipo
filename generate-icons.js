// One-off script: generates PWA home-screen icons (192x192, 512x512) as plain
// PNGs using only Node's built-in zlib — no image library / npm install needed.
// Draws: rounded-square accent-green background + a white "play" triangle.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePNG(size) {
  const bg = [250, 45, 72]; // accent red
  const fg = [255, 255, 255]; // white triangle
  const radius = size * 0.22;

  const raw = Buffer.alloc(size * (1 + size * 4));
  const cx = size / 2, cy = size / 2;

  // Play-triangle geometry (pointing right), centered with slight optical offset.
  const triSize = size * 0.34;
  const ax = cx - triSize * 0.42, ay = cy - triSize * 0.58;
  const bx = cx - triSize * 0.42, by = cy + triSize * 0.58;
  const cxp = cx + triSize * 0.62, cyp = cy;

  function sign(px, py, x1, y1, x2, y2) {
    return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  }
  function inTriangle(px, py) {
    const d1 = sign(px, py, ax, ay, bx, by);
    const d2 = sign(px, py, bx, by, cxp, cyp);
    const d3 = sign(px, py, cxp, cyp, ax, ay);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(hasNeg && hasPos);
  }
  function inRoundedSquare(px, py) {
    const x = Math.min(px, size - 1 - px);
    const y = Math.min(py, size - 1 - py);
    if (x >= radius || y >= radius) return true;
    const dx = radius - x, dy = radius - y;
    return dx * dx + dy * dy <= radius * radius;
  }

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const off = rowStart + 1 + x * 4;
      let r, g, b, a;
      if (!inRoundedSquare(x, y)) {
        r = g = b = 0; a = 0;
      } else if (inTriangle(x, y)) {
        [r, g, b] = fg; a = 255;
      } else {
        [r, g, b] = bg; a = 255;
      }
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const outDir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon-192.png'), makePNG(192));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), makePNG(512));
console.log('Icons written to', outDir);
