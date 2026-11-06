import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { stripJPEGMetadata, stripWebPMetadata } from '../lib/image-metadata-security.mjs';
import { exifFixture, jpegSegment, webpChunk, webpFixture } from './fixtures/image-metadata.mjs';
const jpeg = readFileSync(new URL('./fixtures/contact-small.jpg', import.meta.url));
const webp = readFileSync(new URL('./fixtures/contact-small.webp', import.meta.url));
const privateText = Buffer.from('synthetic-gps-camera-owner');
function minimalExifIn(bytes, prefix = true) {
  const start = prefix ? bytes.indexOf(Buffer.from('Exif\0\0')) + 6 : 0;
  assert.ok(start >= (prefix ? 6 : 0)); const tiff = bytes.subarray(start);
  assert.equal(tiff.toString('ascii', 0, 2), 'II'); const count = tiff.readUInt16LE(8), entries = new Map();
  for (let index = 0; index < count; index++) { const position = 10 + index * 12; entries.set(tiff.readUInt16LE(position), tiff.readUInt32LE(position + 8)); }
  assert.deepEqual([...entries.keys()], [0x0112, 0x8769]);
  assert.equal(tiff.readUInt16LE(entries.get(0x8769)), 1);
  assert.equal(tiff.readUInt16LE(entries.get(0x8769) + 2), 0xa001);
  assert.equal(tiff.readUInt16LE(entries.get(0x8769) + 10), 1);
  return entries.get(0x0112);
}
test('JPEG baseline and progressive encoding without private metadata retain identical bytes', () => {
  for (const image of [jpeg, readFileSync(new URL('./fixtures/contact-progressive.jpg', import.meta.url))]) {
    assert.deepEqual(Buffer.from(stripJPEGMetadata(image)), image);
  }
});
test('JPEG rebuilds either-endian EXIF, retains all eight orientations and removes pointer targets', () => {
  for (const little of [true, false]) for (let orientation = 1; orientation <= 8; orientation++) {
    const original = Buffer.concat([jpeg.subarray(0, 2), jpegSegment(0xe1, exifFixture({ orientation, little })), jpeg.subarray(2)]);
    const clean = Buffer.from(stripJPEGMetadata(original));
    assert.equal(clean.includes(privateText), false); assert.equal(minimalExifIn(clean), orientation);
    assert.deepEqual(Buffer.from(stripJPEGMetadata(clean)), clean, 'second pass is deterministic');
  }
});
test('JPEG comments between progressive scans are removed without changing any compressed bytes', () => {
  const progressive = readFileSync(new URL('./fixtures/contact-progressive.jpg', import.meta.url));
  const first = progressive.indexOf(Buffer.from([255, 0xda])), second = progressive.indexOf(Buffer.from([255, 0xda]), first + 2);
  assert.ok(second > first); const comment = jpegSegment(0xfe, privateText);
  const original = Buffer.concat([progressive.subarray(0, second), comment, progressive.subarray(second, -2), comment, progressive.subarray(-2)]);
  assert.deepEqual(Buffer.from(stripJPEGMetadata(original)), progressive);
});
test('JPEG drops IPTC and thumbnails while preserving ICC, Adobe and HDR/XMP extension bytes', () => {
  const kept = [jpegSegment(0xe2, Buffer.concat([Buffer.from('ICC_PROFILE\0\x01\x01'), privateText])), jpegSegment(0xee, Buffer.from('Adobe\0\x64\0\0\0\0\x01')), jpegSegment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\0hdrgm:Version=1.0')), jpegSegment(0xeb, Buffer.from('unknown-rendering-extension'))];
  const dropped = [jpegSegment(0xfe, privateText), jpegSegment(0xed, Buffer.concat([Buffer.from('Photoshop 3.0\0'), privateText])), jpegSegment(0xe0, Buffer.concat([Buffer.from('JFXX\0\x10'), privateText]))];
  const original = Buffer.concat([jpeg.subarray(0, 2), ...kept, ...dropped, jpeg.subarray(2)]);
  assert.deepEqual(Buffer.from(stripJPEGMetadata(original)), Buffer.concat([jpeg.subarray(0, 2), ...kept, jpeg.subarray(2)]));
  // Add a one-pixel thumbnail to the ordinary JFIF segment.
  assert.equal(jpeg.toString('ascii', 6, 11), 'JFIF\0');
  const payload = Buffer.from(jpeg.subarray(6, 20)); payload[12] = payload[13] = 1;
  const withThumbnail = Buffer.concat([jpeg.subarray(0, 2), jpegSegment(0xe0, Buffer.concat([payload, Buffer.from([255, 0, 0])])), jpeg.subarray(20)]);
  assert.deepEqual(Buffer.from(stripJPEGMetadata(withThumbnail)), jpeg);
});
test('JPEG malformed EXIF, duplicate EXIF, scan truncation and unexpected trailing payload fail closed', () => {
  const malformed = exifFixture(); malformed.writeUInt32LE(0xffffffff, 10);
  for (const exif of [malformed, exifFixture({ orientation: 9 })]) assert.throws(() => stripJPEGMetadata(Buffer.concat([jpeg.subarray(0, 2), jpegSegment(0xe1, exif), jpeg.subarray(2)])), /EXIF/);
  const one = jpegSegment(0xe1, exifFixture()); assert.throws(() => stripJPEGMetadata(Buffer.concat([jpeg.subarray(0, 2), one, one, jpeg.subarray(2)])), /duplicate EXIF/);
  assert.throws(() => stripJPEGMetadata(jpeg.subarray(0, -1)), /JPEG/);
  assert.throws(() => stripJPEGMetadata(Buffer.concat([jpeg, privateText])), /JPEG end/);
});
test('WebP removes XMP and unknown chunks, reconstructs EXIF, repairs RIFF length and metadata flags', () => {
  for (const prefix of [true, false]) {
    const original = webpFixture(webp, [webpChunk('EXIF', exifFixture({ prefix })), webpChunk('XMP ', privateText), webpChunk('cust', privateText)]);
    const clean = Buffer.from(stripWebPMetadata(original));
    assert.equal(clean.includes(privateText), false); assert.equal(clean[20] & 0x0c, 8); assert.equal(clean.readUInt32LE(4), clean.length - 8);
    const exifStart = clean.indexOf(Buffer.from('EXIF')), payload = clean.subarray(exifStart + 8, exifStart + 8 + clean.readUInt32LE(exifStart + 4));
    assert.equal(minimalExifIn(payload, prefix), 6);
    assert.deepEqual(Buffer.from(stripWebPMetadata(clean)), clean);
    assert.ok(clean.subarray(-webp.length + 12).equals(webp.subarray(12)), 'compressed frame remains exact');
  }
});
test('WebP ordinary bytes, color profile and alpha flags are preserved while empty EXIF disappears', () => {
  assert.deepEqual(Buffer.from(stripWebPMetadata(webp)), webp);
  const exif = Buffer.from('49492a0008000000000000000000', 'hex'), profile = webpChunk('ICCP', privateText);
  const original = webpFixture(webp, [profile, webpChunk('EXIF', exif), webpChunk('XMP ', privateText)], { flags: 0x3c });
  const clean = Buffer.from(stripWebPMetadata(original)); assert.equal(clean[20], 0x30);
  assert.ok(clean.includes(profile)); assert.equal(clean.includes(Buffer.from('EXIF')), false); assert.equal(clean.includes(Buffer.from('XMP ')), false);
});
test('WebP odd metadata padding, oversized chunks, duplicate EXIF and malformed TIFF are rejected or scrubbed safely', () => {
  const odd = webpFixture(webp, [webpChunk('XMP ', 'abc')]); const clean = Buffer.from(stripWebPMetadata(odd)); assert.equal(clean[20] & 0x0c, 0);
  const broken = Buffer.from(odd); broken.writeUInt32LE(0xffffffff, 34); assert.throws(() => stripWebPMetadata(broken), /chunk length/);
  const truncated = odd.subarray(0, -1); assert.throws(() => stripWebPMetadata(truncated), /WebP length/);
  assert.throws(() => stripWebPMetadata(webpFixture(webp, [webpChunk('EXIF', exifFixture()), webpChunk('EXIF', exifFixture())])), /duplicate chunk/);
  assert.throws(() => stripWebPMetadata(webpFixture(webp, [webpChunk('EXIF', 'Exif\0\0bad')])), /EXIF/);
});

test('real JPEG and WebP decode to identical oriented pixels after metadata scrubbing, including an embedded color profile', async () => {
  const require = createRequire(import.meta.url), sharp = createRequire(createRequire(require.resolve('wrangler')).resolve('miniflare'))('sharp');
  const profiledJPEG = await sharp(jpeg).withIccProfile('p3').jpeg().toBuffer();
  for (const orientation of [1, 6, 8]) {
    const originalJPEG = Buffer.concat([profiledJPEG.subarray(0, 2), jpegSegment(0xe1, exifFixture({ orientation })), profiledJPEG.subarray(2)]);
    const originalWebP = webpFixture(webp, [webpChunk('EXIF', exifFixture({ orientation })), webpChunk('XMP ', privateText)]);
    for (const [original, clean] of [[originalJPEG, stripJPEGMetadata(originalJPEG)], [originalWebP, stripWebPMetadata(originalWebP)]]) {
      const before = await sharp(original).autoOrient().raw().toBuffer({ resolveWithObject: true }), after = await sharp(Buffer.from(clean)).autoOrient().raw().toBuffer({ resolveWithObject: true });
      assert.deepEqual([before.info.width, before.info.height], orientation === 1 ? [20, 10] : [10, 20]);
      assert.deepEqual(after.info, before.info); assert.deepEqual(after.data, before.data);
    }
  }
});
