import { deflateSync } from "node:zlib";
// Deterministic package asset: a download arrow on a rounded dark tile.
export function downloaderIcon() {
  const size = 128, scan = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = y * (1 + size * 4) + 1 + x * 4;
    const corner = (x < 16 && y < 16 && (x - 16) ** 2 + (y - 16) ** 2 > 256)
      || (x > 111 && y < 16 && (x - 111) ** 2 + (y - 16) ** 2 > 256)
      || (x < 16 && y > 111 && (x - 16) ** 2 + (y - 111) ** 2 > 256)
      || (x > 111 && y > 111 && (x - 111) ** 2 + (y - 111) ** 2 > 256);
    const arrow = (x >= 56 && x <= 71 && y >= 25 && y <= 67)
      || (y >= 54 && y <= 83 && Math.abs(x - 63.5) <= 83 - y)
      || (y >= 91 && y <= 99 && x >= 33 && x <= 94);
    scan[p] = arrow ? 113 : 19; scan[p + 1] = arrow ? 212 : 32; scan[p + 2] = arrow ? 245 : 50; scan[p + 3] = corner ? 0 : 255;
  }
  function chunk(type, data) {
    const name = Buffer.from(type), bytes = Buffer.concat([name, data]); let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const header = Buffer.alloc(4), tail = Buffer.alloc(4); header.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, bytes, tail]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(scan)), chunk("IEND", Buffer.alloc(0))]);
}
