import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const iconDir = resolve(import.meta.dirname, '../src-tauri/icons');
await mkdir(iconDir, { recursive: true });

const icon128 = png(128);
const icon256 = png(256);
await writeFile(resolve(iconDir, 'icon.png'), icon256);
await writeFile(resolve(iconDir, 'icon.icns'), icns([
  ['ic07', icon128],
  ['ic08', icon256],
]));
await writeFile(resolve(iconDir, 'icon.ico'), ico(icon256));

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const scale = size / 256;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      const offset = row + 1 + x * 4;
      let color = [16, 42, 67, 255];
      if (insidePin(px, py)) color = [239, 246, 255, 255];
      if (insideCircle(px, py, 128, 100, 45)) color = [16, 42, 67, 255];
      if (insideCircle(px, py, 128, 100, 18)) color = [45, 212, 191, 255];
      raw.set(color, offset);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insidePin(x, y) {
  const centerX = 128;
  if (y <= 132) return insideCircle(x, y, centerX, 100, 75);
  if (y > 230) return false;
  const halfWidth = (230 - y) * (70 / 98);
  return Math.abs(x - centerX) <= halfWidth;
}

function insideCircle(x, y, centerX, centerY, radius) {
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function icns(images) {
  const contents = images.map(([type, data]) => {
    const item = Buffer.alloc(8 + data.length);
    item.write(type, 0, 4, 'ascii');
    item.writeUInt32BE(item.length, 4);
    data.copy(item, 8);
    return item;
  });
  const size = 8 + contents.reduce((sum, item) => sum + item.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(size, 4);
  return Buffer.concat([header, ...contents]);
}

function ico(image) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 0;
  header[7] = 0;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(image.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, image]);
}
