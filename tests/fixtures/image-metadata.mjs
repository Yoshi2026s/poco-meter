// Harmless synthetic metadata; no personal information is used in these fixtures.
export function jpegSegment(marker, payload) {
  payload = Buffer.from(payload); const header = Buffer.from([255, marker, 0, 0]); header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}
export function exifFixture({ orientation = 6, colorSpace = 1, little = true, prefix = true } = {}) {
  const secret = Buffer.from('synthetic-gps-camera-owner\0'), tiff = Buffer.alloc(128 + secret.length);
  const u16 = (offset, value) => little ? tiff.writeUInt16LE(value, offset) : tiff.writeUInt16BE(value, offset);
  const u32 = (offset, value) => little ? tiff.writeUInt32LE(value, offset) : tiff.writeUInt32BE(value, offset);
  tiff.write(little ? 'II' : 'MM'); u16(2, 42); u32(4, 8); u16(8, 5);
  function entry(offset, tag, type, count, value) {
    u16(offset, tag); u16(offset + 2, type); u32(offset + 4, count);
    if (type === 3 && count === 1) u16(offset + 8, value); else u32(offset + 8, value);
  }
  entry(10, 0x0112, 3, 1, orientation); // orientation
  entry(22, 0x010f, 2, secret.length, 128); // camera make
  entry(34, 0x0132, 2, secret.length, 128); // timestamp, deliberately synthetic
  entry(46, 0x8769, 4, 1, 74); // EXIF directory
  entry(58, 0x8825, 4, 1, 92); // GPS directory
  u16(74, 1); entry(76, 0xa001, 3, 1, colorSpace);
  u16(92, 1); entry(94, 0x0001, 2, secret.length, 128);
  secret.copy(tiff, 128); return prefix ? Buffer.concat([Buffer.from('Exif\0\0'), tiff]) : tiff;
}
export function webpChunk(kind, payload) {
  payload = Buffer.from(payload); const chunk = Buffer.alloc(8 + payload.length + payload.length % 2);
  chunk.write(kind, 0, 'ascii'); chunk.writeUInt32LE(payload.length, 4); payload.copy(chunk, 8); return chunk;
}
export function webpFixture(simple, chunks, { flags = 0x0c } = {}) {
  const extended = Buffer.alloc(10); extended[0] = flags; extended.writeUIntLE(19, 4, 3); extended.writeUIntLE(9, 7, 3);
  const content = Buffer.concat([webpChunk('VP8X', extended), ...chunks, simple.subarray(12)]), header = Buffer.from('RIFF\0\0\0\0WEBP');
  header.writeUInt32LE(content.length + 4, 4); return Buffer.concat([header, content]);
}
