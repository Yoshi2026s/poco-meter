// This is a bounded container scrub, not a JPEG/WebP decoder. Keep color profiles
// and JPEG extension APP markers (including XMP/HDR) to avoid changing rendering.
// Consequently this removes common personal metadata, not every possible payload.
const ascii = (bytes, offset, value) => [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
function join(parts) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let position = 0; for (const part of parts) { bytes.set(part, position); position += part.length; }
  return bytes;
}
function unchangedOrOriginal(original, parts) {
  const clean = join(parts);
  return clean.length === original.length && clean.every((byte, index) => byte === original[index]) ? original : clean;
}

// Rebuild TIFF rather than zeroing GPS fields: removing pointers alone can leave
// coordinates, maker notes, timestamps and thumbnails in the remaining bytes.
function minimalExif(bytes) {
  const prefixed = ascii(bytes, 0, 'Exif\0\0'), offset = prefixed ? 6 : 0;
  const tiff = bytes.subarray(offset), view = new DataView(tiff.buffer, tiff.byteOffset, tiff.length);
  if (tiff.length < 8 || !ascii(tiff, 0, 'II') && !ascii(tiff, 0, 'MM')) throw new Error('EXIF byte order');
  const little = tiff[0] === 0x49;
  if (view.getUint16(2, little) !== 42) throw new Error('EXIF header');
  function directory(position) {
    if (position < 8 || position + 2 > tiff.length) throw new Error('EXIF directory');
    const count = view.getUint16(position, little);
    if (position + 2 + count * 12 + 4 > tiff.length) throw new Error('EXIF entries');
    const result = new Map();
    for (let index = 0; index < count; index++) {
      const entry = position + 2 + index * 12, tag = view.getUint16(entry, little);
      if ([0x0112, 0x8769, 0xa001].includes(tag)) {
        if (result.has(tag)) throw new Error('EXIF duplicate rendering tag');
        result.set(tag, { type: view.getUint16(entry + 2, little), count: view.getUint32(entry + 4, little), entry });
      }
    }
    return result;
  }
  function scalar(entry, type) {
    if (!entry) return undefined;
    if (entry.type !== type || entry.count !== 1) throw new Error('EXIF rendering tag');
    return type === 3 ? view.getUint16(entry.entry + 8, little) : view.getUint32(entry.entry + 8, little);
  }
  const main = directory(view.getUint32(4, little)), orientation = scalar(main.get(0x0112), 3);
  if (orientation !== undefined && (orientation < 1 || orientation > 8)) throw new Error('EXIF orientation');
  const exifOffset = scalar(main.get(0x8769), 4);
  const colorSpace = exifOffset === undefined ? undefined : scalar(directory(exifOffset).get(0xa001), 3);
  if (colorSpace !== undefined && ![1, 2, 65535].includes(colorSpace)) throw new Error('EXIF color space');
  if (orientation === undefined && colorSpace === undefined) return null;
  const count = Number(orientation !== undefined) + Number(colorSpace !== undefined), subOffset = 8 + 2 + 12 * count + 4;
  const clean = new Uint8Array(subOffset + (colorSpace === undefined ? 0 : 18)), output = new DataView(clean.buffer);
  clean.set([0x49, 0x49, 42, 0, 8, 0, 0, 0]); output.setUint16(8, count, true);
  function entry(position, tag, type, value) {
    output.setUint16(position, tag, true); output.setUint16(position + 2, type, true); output.setUint32(position + 4, 1, true);
    if (type === 3) output.setUint16(position + 8, value, true); else output.setUint32(position + 8, value, true);
  }
  let position = 10;
  if (orientation !== undefined) { entry(position, 0x0112, 3, orientation); position += 12; }
  if (colorSpace !== undefined) {
    entry(position, 0x8769, 4, subOffset); output.setUint16(subOffset, 1, true); entry(subOffset + 2, 0xa001, 3, colorSpace);
  }
  return prefixed ? join([bytes.subarray(0, 6), clean]) : clean;
}
function jpegSegment(marker, payload) {
  const header = new Uint8Array([255, marker, 0, 0]); new DataView(header.buffer).setUint16(2, payload.length + 2);
  return join([header, payload]);
}
export function stripJPEGMetadata(bytes) {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 0xd8) throw new Error('JPEG start');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), parts = [bytes.subarray(0, 2)];
  let position = 2, inScan = false, sawScan = false, sawExif = false;
  while (position < bytes.length) {
    if (inScan) {
      const start = position;
      while (position < bytes.length) {
        if (bytes[position] !== 255) { position++; continue; }
        let code = position + 1; while (bytes[code] === 255) code++;
        if (code >= bytes.length) throw new Error('JPEG truncated scan');
        if (bytes[code] === 0 || bytes[code] === 1 || bytes[code] >= 0xd0 && bytes[code] <= 0xd7) { position = code + 1; continue; }
        break;
      }
      parts.push(bytes.subarray(start, position)); inScan = false;
    }
    const start = position;
    if (bytes[position++] !== 255) throw new Error('JPEG marker');
    while (bytes[position] === 255) position++;
    const marker = bytes[position++];
    if (marker === 0xd9) {
      if (!sawScan || position !== bytes.length) throw new Error('JPEG end');
      parts.push(bytes.subarray(start, position)); return unchangedOrOriginal(bytes, parts);
    }
    if (marker === undefined || marker === 0 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7) throw new Error('JPEG unexpected marker');
    if (marker === 1) { parts.push(bytes.subarray(start, position)); continue; }
    if (position + 2 > bytes.length) throw new Error('JPEG marker length');
    const length = view.getUint16(position), end = position + length;
    if (length < 2 || end > bytes.length) throw new Error('JPEG segment');
    const payload = bytes.subarray(position + 2, end);
    if (marker === 0xe1 && ascii(payload, 0, 'Exif\0\0')) {
      if (sawExif) throw new Error('JPEG duplicate EXIF');
      sawExif = true; const clean = minimalExif(payload); if (clean) parts.push(jpegSegment(marker, clean));
    } else if (marker === 0xe0 && ascii(payload, 0, 'JFIF\0')) {
      if (payload.length < 14 || 14 + payload[12] * payload[13] * 3 !== payload.length) throw new Error('JPEG thumbnail');
      const clean = Uint8Array.from(payload.subarray(0, 14)); clean[12] = clean[13] = 0; parts.push(jpegSegment(marker, clean));
    } else if (marker === 0xfe || marker === 0xe0 && ascii(payload, 0, 'JFXX\0') || marker === 0xed && ascii(payload, 0, 'Photoshop 3.0\0')) {
      // Comments, alternate thumbnails and Photoshop/IPTC resources are omitted.
    } else {
      parts.push(bytes.subarray(start, end));
    }
    position = end;
    if (marker === 0xda) { sawScan = true; inScan = true; }
  }
  throw new Error('JPEG missing end');
}
function webpChunk(kind, payload) {
  const chunk = new Uint8Array(8 + payload.length + (payload.length & 1));
  for (let index = 0; index < 4; index++) chunk[index] = kind.charCodeAt(index);
  new DataView(chunk.buffer).setUint32(4, payload.length, true); chunk.set(payload, 8); return chunk;
}
export function stripWebPMetadata(bytes) {
  if (bytes.length < 20 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) throw new Error('WebP header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (view.getUint32(4, true) !== bytes.length - 8) throw new Error('WebP length');
  const chunks = [], seen = new Set(); let extended = null, hasExif = false, frame = false;
  for (let position = 12; position < bytes.length;) {
    if (position + 8 > bytes.length) throw new Error('WebP chunk header');
    const kind = String.fromCharCode(...bytes.subarray(position, position + 4)), length = view.getUint32(position + 4, true);
    const start = position + 8, end = start + length + (length & 1);
    if (end > bytes.length) throw new Error('WebP chunk length');
    const payload = bytes.subarray(start, start + length);
    if (kind === 'ANIM' || kind === 'ANMF') throw new Error('Animated WebP');
    if (['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ICCP', 'EXIF'].includes(kind)) {
      if (seen.has(kind)) throw new Error('WebP duplicate chunk'); seen.add(kind);
    }
    if (kind === 'VP8X') {
      if (position !== 12 || length !== 10 || payload[0] & 2) throw new Error('WebP extended header');
      extended = webpChunk(kind, payload); chunks.push(extended);
    } else if (kind === 'EXIF') {
      if (!extended) throw new Error('WebP EXIF without extended header');
      const clean = minimalExif(payload); if (clean) { chunks.push(webpChunk(kind, clean)); hasExif = true; }
    } else if (['ICCP', 'ALPH', 'VP8 ', 'VP8L'].includes(kind)) {
      if (kind === 'VP8 ' || kind === 'VP8L') { if (frame) throw new Error('WebP multiple frames'); frame = true; }
      chunks.push(bytes.subarray(position, end));
    }
    // XMP and unknown chunks are non-rendering metadata in the WebP container.
    position = end;
  }
  if (!frame) throw new Error('WebP missing frame');
  if (extended) extended[8] = (extended[8] & ~0x0c) | (hasExif ? 0x08 : 0);
  const header = Uint8Array.from(bytes.subarray(0, 12)); new DataView(header.buffer).setUint32(4, 4 + chunks.reduce((size, chunk) => size + chunk.length, 0), true);
  return unchangedOrOriginal(bytes, [header, ...chunks]);
}
