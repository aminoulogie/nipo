// Generates the PWA home-screen icons (192 and 512) as PNGs using only Node's
// built-in zlib — no image library, so there is nothing to install.
//
// Design: a rounded square carrying a warm red-to-orange diagonal gradient,
// with a white pair of beamed eighth notes centred on it.
//
// Everything is rendered at 3x and box-filtered down. That is what gives the
// curves and the rounded corners clean edges; drawing straight at the final
// size produced visibly jagged diagonals.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SS = 3; // supersample factor

// ---------- PNG container ----------
function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
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

function encodePNG(size, rgba) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Geometry (unit space, 0..1) ----------
function inRoundedSquare(u, v, radius) {
  const x = Math.min(u, 1 - u);
  const y = Math.min(v, 1 - v);
  if (x >= radius || y >= radius) return true;
  const dx = radius - x, dy = radius - y;
  return dx * dx + dy * dy <= radius * radius;
}

function inEllipse(u, v, cx, cy, rx, ry) {
  const dx = (u - cx) / rx, dy = (v - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function inRect(u, v, x0, y0, x1, y1) {
  return u >= x0 && u <= x1 && v >= y0 && v <= y1;
}

// The beam is a bar sheared along y.
function inBeam(u, v, x0, x1, yTop, thickness, slant) {
  if (u < x0 || u > x1) return false;
  const t = (u - x0) / (x1 - x0);
  const y = yTop + slant * t;
  return v >= y && v <= y + thickness;
}

// Two beamed eighth notes.
function inNote(u, v) {
  const stemW = 0.052;
  const leftStemX = 0.335;
  const rightStemX = 0.655;
  const stemTop = 0.185;
  const stemBottom = 0.665;

  // Note heads sit at the foot of each stem, the left one hanging lower.
  if (inEllipse(u, v, leftStemX - 0.052, 0.722, 0.105, 0.078)) return true;
  if (inEllipse(u, v, rightStemX - 0.052, 0.667, 0.105, 0.078)) return true;

  // Stems.
  if (inRect(u, v, leftStemX, stemTop + 0.055, leftStemX + stemW, stemBottom + 0.055)) return true;
  if (inRect(u, v, rightStemX, stemTop, rightStemX + stemW, stemBottom)) return true;

  // Beam joining the stems, slanting down toward the left.
  if (inBeam(u, v, leftStemX, rightStemX + stemW, stemTop + 0.055, 0.088, -0.055)) return true;

  return false;
}

// ---------- Colour ----------
function gradientAt(u, v) {
  const t = Math.min(1, Math.max(0, u * 0.45 + v * 0.75));
  const stops = [
    [0.00, [255, 58, 98]],
    [0.55, [250, 45, 72]],
    [1.00, [255, 126, 46]],
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const span = b[0] - a[0] || 1;
  const k = (t - a[0]) / span;
  return [
    Math.round(a[1][0] + (b[1][0] - a[1][0]) * k),
    Math.round(a[1][1] + (b[1][1] - a[1][1]) * k),
    Math.round(a[1][2] + (b[1][2] - a[1][2]) * k),
  ];
}

// ---------- Render ----------
// square: iOS app icons must be fully opaque with square corners — the system
// applies its own mask, and a pre-rounded transparent icon renders with dark
// fringing inside the mask.
function makeIcon(size, { square = false } = {}) {
  const big = size * SS;
  const radius = square ? 0 : 0.225; // fraction of the edge
  const hi = Buffer.alloc(big * big * 4);

  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const u = (x + 0.5) / big;
      const v = (y + 0.5) / big;
      const off = (y * big + x) * 4;

      if (!square && !inRoundedSquare(u, v, radius)) continue; // left transparent

      if (inNote(u, v)) {
        hi[off] = 255; hi[off + 1] = 255; hi[off + 2] = 255; hi[off + 3] = 255;
      } else {
        const [r, g, b] = gradientAt(u, v);
        hi[off] = r; hi[off + 1] = g; hi[off + 2] = b; hi[off + 3] = 255;
      }
    }
  }

  // Average each SSxSS block, weighting colour by alpha so partly covered
  // edge pixels do not pick up a dark fringe from the transparent ones.
  const out = Buffer.alloc(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const o = ((y * SS + dy) * big + (x * SS + dx)) * 4;
          const alpha = hi[o + 3] / 255;
          r += hi[o] * alpha;
          g += hi[o + 1] * alpha;
          b += hi[o + 2] * alpha;
          a += hi[o + 3];
        }
      }
      const outOff = (y * size + x) * 4;
      if (a > 0) {
        const norm = a / 255;
        out[outOff] = Math.round(r / norm);
        out[outOff + 1] = Math.round(g / norm);
        out[outOff + 2] = Math.round(b / norm);
      }
      out[outOff + 3] = Math.round(a / n);
    }
  }
  return encodePNG(size, out);
}

const outDir = path.join(__dirname, 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), makeIcon(size));
}
console.log('Icons written to', outDir);

// The native app icon, when the iOS project is present.
const iosIcon = path.join(
  __dirname, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png',
);
if (fs.existsSync(path.dirname(iosIcon))) {
  fs.writeFileSync(iosIcon, makeIcon(1024, { square: true }));
  console.log('iOS app icon written to', iosIcon);
}
