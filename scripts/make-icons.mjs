/**
 * Draws the app icon -- a meter face with a needle -- straight into a PNG.
 *
 * Written by hand rather than pulled from a canvas or image library because the
 * icon is three shapes, and a build that needs no native dependency is worth
 * more than the forty lines this costs.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixel) {
  // One filter byte (0 = none) then RGB per row.
  const raw = Buffer.alloc(size * (1 + size * 3));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));

/** Signed distance from a point to a segment, for drawing the needle. */
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function draw(size) {
  const c = size / 2;
  const faceRadius = size * 0.36;
  // Needle sweeps to about two thirds of the scale, like a reading in daylight.
  const angle = (-38 * Math.PI) / 180;
  const tipX = c + Math.sin(angle) * faceRadius * 0.86;
  const tipY = c + size * 0.2 - Math.cos(angle) * faceRadius * 0.86;
  const pivotX = c;
  const pivotY = c + size * 0.2;

  return (x, y) => {
    const body = mix([38, 43, 51], [11, 13, 16], y / size);
    let colour = body;

    const distanceFromPivot = Math.hypot(x - pivotX, y - pivotY);

    // Engraved arc.
    const ring = Math.abs(distanceFromPivot - faceRadius);
    if (ring < size * 0.022 && y < pivotY) {
      colour = mix(colour, [125, 255, 176], 1 - ring / (size * 0.022));
    }

    // Needle.
    const needle = distanceToSegment(x, y, pivotX, pivotY, tipX, tipY);
    if (needle < size * 0.018) colour = mix([255, 90, 77], colour, needle / (size * 0.018));

    // Pivot cap.
    if (distanceFromPivot < size * 0.045) {
      colour = mix([170, 178, 188], [40, 45, 52], distanceFromPivot / (size * 0.045));
    }

    // Round the corners so it sits well as a tile.
    const corner = size * 0.22;
    const cx = Math.max(corner - x, x - (size - corner), 0);
    const cy = Math.max(corner - y, y - (size - corner), 0);
    if (Math.hypot(cx, cy) > corner) colour = [7, 8, 10];

    return colour;
  };
}

for (const size of [192, 512]) {
  writeFileSync(resolve(OUT, `icon-${size}.png`), png(size, draw(size)));
}

console.log('icons written to public/');
