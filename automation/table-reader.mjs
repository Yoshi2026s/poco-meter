// Reads ONECARAT monthly border table images (second source channel).
// Digits are matched against glyphs learned only from days already present in
// data/borders.json. A value is accepted only when every digit is matched with a
// clear margin AND the image reads all of its already-known cells exactly.
// Nothing here guesses: unclear cells are left out.
import {inflateSync} from 'node:zlib';

export const MIN_MARGIN = 8;          // misreads seen so far scored 0.44; correct reads >= 12
const DARK = 120, GW = 12, GH = 16, MAX_SAMPLES_PER_DIGIT_PER_IMAGE = 60;
export const GROUPS = {'D1-C3': ['D1', 'D2', 'D3', 'C1', 'C2', 'C3'], 'B1-A3': ['B1', 'B2', 'B3', 'A1', 'A2', 'A3'], 'S1-S6': ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']};

// ---- PNG (8-bit, non-interlaced; grey, RGB, palette, grey+alpha, RGBA) -> luminance ----
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0, palette = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  const channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[type];
  if (depth !== 8 || interlace !== 0 || !channels || (type === 3 && !palette)) throw new Error('unsupported PNG format');
  if (width < 1 || height < 1 || width * height > 12_000_000) throw new Error('unsupported PNG size');
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels, out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = out.subarray(y * stride, (y + 1) * stride), prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0, b = prev ? prev[i] : 0, c = prev && i >= channels ? prev[i - channels] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new Error('bad PNG filter');
      row[i] = v & 255;
    }
  }
  const gray = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    let r, g, bl, al = 255; const o = p * channels;
    if (type === 0) r = g = bl = out[o]; else if (type === 4) { r = g = bl = out[o]; al = out[o + 1]; }
    else if (type === 3) { const k = out[o] * 3; r = palette[k]; g = palette[k + 1]; bl = palette[k + 2]; }
    else { r = out[o]; g = out[o + 1]; bl = out[o + 2]; if (type === 6) al = out[o + 3]; }
    const lum = (bl * 29 + g * 150 + r * 77) >> 8;
    gray[p] = Math.round((lum * al + 255 * (255 - al)) / 255);
  }
  return {width, height, px: (x, y) => gray[y * width + x]};
}

// ---- layout: text lines and value columns found from where the ink is ----
function runs(flags, minGap) {
  const out = []; let s = -1, gap = 0;
  flags.forEach((on, i) => { if (on) { if (s < 0) s = i; gap = 0; } else if (s >= 0 && ++gap > minGap) { out.push([s, i - gap]); s = -1; gap = 0; } });
  if (s >= 0) out.push([s, flags.length - 1 - gap]);
  return out;
}
export function layout(img) {
  const {width: W, height: H, px} = img;
  // value columns: vertical ink projection below the header, rightmost 6 blocks
  const startY = Math.min(H - 1, 40), colInk = new Array(W).fill(0);
  for (let x = 0; x < W; x++) for (let y = startY; y < H; y++) if (px(x, y) < DARK) colInk[x]++;
  const blocks = runs(colInk.map(n => n > 0), 14).filter(([a, b]) => b - a >= 6);
  if (blocks.length < 6) throw new Error('table columns not found');
  const cols = blocks.slice(-6);
  // text lines inside the value columns
  const rowInk = new Array(H).fill(false);
  for (let y = 0; y < H; y++) for (const [a, b] of cols) { for (let x = a; x <= b; x++) if (px(x, y) < DARK) { rowInk[y] = true; break; } if (rowInk[y]) break; }
  const lines = runs(rowInk, 2).filter(([a, b]) => b - a >= 6);
  if (lines.length < 4) throw new Error('table rows not found');
  const [header, ...values] = lines;
  const centers = values.map(([a, b]) => (a + b) / 2), diffs = centers.slice(1).map((c, i) => c - centers[i]).sort((a, b) => a - b);
  const pitch = diffs[Math.floor(diffs.length / 2)];
  if (!(pitch > 10 && pitch < 60)) throw new Error('row pitch not found');
  // each value line gets a row index from the uniform pitch (robust to a fully blank row)
  const rows = values.map(([a, b]) => ({y0: a, y1: b, index: Math.round(((a + b) / 2 - centers[0]) / pitch)}));
  // number of row slots the image has (including fully blank rows at the end)
  const slots = Math.floor((H - (centers[0] - pitch / 2)) / pitch + 0.25);
  return {cols, header, rows, pitch, slots};
}

// ---- glyphs ----
function glyphs(img, x0, x1, y0, y1) {
  let bg = 0; for (let x = x0; x <= x1; x += 2) for (let y = y0; y <= y1; y++) bg = Math.max(bg, img.px(x, y));
  const ink = (x, y) => Math.max(0, Math.min(1, (bg - img.px(x, y)) / Math.max(40, bg - 20)));
  const dark = []; for (let x = x0; x <= x1; x++) { let d = false; for (let y = y0; y <= y1; y++) if (ink(x, y) > 0.35) { d = true; break; } dark.push(d); }
  const parts = [];
  for (const [a, b] of runs(dark, 0).map(([a, b]) => [x0 + a, x0 + b])) {
    const w = b - a + 1;
    if (w >= 15) { // two touching digits: split at the thinnest column
      let best = a + (w >> 1), least = Infinity;
      for (let x = a + Math.floor(w * 0.3); x <= a + Math.ceil(w * 0.7); x++) { let t = 0; for (let y = y0; y <= y1; y++) t += ink(x, y); if (t < least) { least = t; best = x; } }
      parts.push([a, best - 1], [best + 1, b]);
    } else parts.push([a, b]);
  }
  const out = parts.filter(([a, b]) => b >= a).map(([a, b]) => {
    let top = y1, bot = y0;
    for (let x = a; x <= b; x++) for (let y = y0; y <= y1; y++) if (ink(x, y) > 0.35) { top = Math.min(top, y); bot = Math.max(bot, y); }
    const width = b - a + 1, height = bot - top + 1, vec = new Float32Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) vec[gy * GW + gx] = ink(Math.min(b, Math.floor(a + (gx + 0.5) * width / GW)), Math.min(bot, Math.floor(top + (gy + 0.5) * height / GH)));
    return {width, height, top, vec};
  });
  const digitH = Math.max(0, ...out.map(g => g.height)), mid = (y0 + y1) / 2;
  return out.map(g => ({...g, comma: g.height < digitH * 0.6 && g.top > mid - 2}));
}

// cells[rowIndex][col] -> glyph list
export function tableCells(img) {
  const lay = layout(img), cells = new Map();
  for (const row of lay.rows) cells.set(row.index, lay.cols.map(([a, b]) => glyphs(img, Math.max(0, a - 2), Math.min(img.width - 1, b + 2), Math.max(0, row.y0 - 2), Math.min(img.height - 1, row.y1 + 2))));
  return {cells, pitch: lay.pitch, slots: lay.slots};
}

function nearest(vec, samples) {
  const best = {};
  for (const s of samples) { let d = 0; for (let i = 0; i < vec.length; i++) { const t = vec[i] - s.vec[i]; d += t * t; } if (best[s.d] === undefined || d < best[s.d]) best[s.d] = d; }
  const sorted = Object.entries(best).sort((a, b) => a[1] - b[1]);
  return {digit: sorted[0][0], dist: sorted[0][1], margin: sorted.length > 1 ? sorted[1][1] - sorted[0][1] : 0};
}
// maxDist: a glyph further than this from every learned digit is unlike any digit (smudge,
// overlap, unknown symbol) and is treated as unreadable even if one digit is "least bad".
export function readCell(gl, samples, maxDist = Infinity) {
  if (!gl.some(g => !g.comma)) return {empty: true, value: null, margin: Infinity, text: ''};
  let text = '', margin = Infinity, wide = false, far = 0;
  for (const g of gl) {
    if (g.comma) { text += ','; continue; }
    if (g.width >= 15) wide = true;
    const n = nearest(g.vec, samples); text += n.digit; margin = Math.min(margin, n.margin); far = Math.max(far, n.dist);
    if (n.dist > maxDist) margin = 0;
  }
  const ok = /^\d{1,3}(,\d{3})*$/.test(text);
  return {empty: false, text, margin, far, value: ok && !wide ? Number(text.replace(/,/g, '')) : null};
}
// Largest nearest-sample distance among correctly read digits of known cells, with headroom.
function distanceLimit(t, samples, known, ranks) {
  const ds = [];
  for (const [index, row] of t.parsed.cells) {
    const date = `${t.month}-${String(Math.floor(index / 3) + 1).padStart(2, '0')}`, k = known(date, t.close);
    if (!k) continue;
    row.forEach((gl, c) => {
      const v = k[ranks[c]]?.[index % 3]; if (v === undefined) return;
      const digits = String(v), dg = gl.filter(g => !g.comma);
      if (dg.length !== digits.length) return;
      dg.forEach((g, i) => { const n = nearest(g.vec, samples); if (n.digit === digits[i]) ds.push(n.dist); });
    });
  }
  if (!ds.length) return 0;
  ds.sort((a, b) => a - b);
  return ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.995))] * 1.5 + 1;
}

// table = {key, month: 'YYYY-MM', close, group, img}; known(date, close) -> ranks | undefined
export function learnSamples(tables, known) {
  const out = [];
  for (const t of tables) {
    const ranks = GROUPS[t.group], perDigit = {}; // cap per image, so every image contributes
    out.push(perDigit);
    for (const [index, row] of t.parsed.cells) {
      const date = `${t.month}-${String(Math.floor(index / 3) + 1).padStart(2, '0')}`, k = known(date, t.close);
      row.forEach((gl, c) => {
        const v = k?.[ranks[c]]?.[index % 3]; if (v === undefined) return;
        const digits = String(v), dg = gl.filter(g => !g.comma);
        if (dg.length !== digits.length) return;
        dg.forEach((g, i) => { const list = perDigit[digits[i]] ??= []; if (list.length < MAX_SAMPLES_PER_DIGIT_PER_IMAGE) list.push({d: digits[i], vec: g.vec, from: t.key}); });
      });
    }
  }
  return out.flatMap(perDigit => Object.values(perDigit).flat());
}

// Reads every table; returns accepted values per (date, close, rank) plus per-image validation.
export function readTables(tables, known, {minMargin = MIN_MARGIN, minKnownCells = 12, wanted = () => true} = {}) {
  for (const t of tables) t.parsed = tableCells(t.img);
  const all = learnSamples(tables, known);
  const results = [], images = [];
  for (const t of tables) {
    const ranks = GROUPS[t.group];
    // templates from other images (leave-one-image-out): same row height when every digit has
    // enough samples there, otherwise every other image (glyphs are size-normalised)
    const peers = new Set(tables.filter(o => o !== t && Math.abs(o.parsed.pitch - t.parsed.pitch) <= 2).map(o => o.key));
    const same = all.filter(s => peers.has(s.from)), count = {};
    for (const s of same) count[s.d] = (count[s.d] ?? 0) + 1;
    const samples = Object.keys(count).length === 10 && Object.values(count).every(n => n >= 20) ? same : all.filter(s => s.from !== t.key);
    const digitsCovered = new Set(samples.map(s => s.d)).size;
    const maxDist = distanceLimit(t, samples, known, ranks);
    // validation on this image's already-known cells:
    //  - a confident reading (margin >= minMargin) must never be wrong
    //  - low-confidence readings would be left out anyway; most known cells must still be confident
    let checked = 0, confidentRight = 0, confidentWrong = 0;
    for (const [index, row] of t.parsed.cells) {
      const date = `${t.month}-${String(Math.floor(index / 3) + 1).padStart(2, '0')}`, k = known(date, t.close);
      if (!k) continue;
      row.forEach((gl, c) => {
        const v = k[ranks[c]]?.[index % 3]; if (v === undefined) return; checked++;
        const r = readCell(gl, samples, maxDist); if (r.margin < minMargin) return;
        if (r.value === v) confidentRight++; else confidentWrong++;
      });
    }
    const trusted = digitsCovered === 10 && checked >= minKnownCells && confidentWrong === 0 && confidentRight >= checked * 0.9;
    images.push({key: t.key, url: t.url, sha256: t.sha256, knownCells: `${confidentRight}/${checked}`, confidentWrong, trusted});
    if (!trusted) continue;
    for (const [index, row] of t.parsed.cells) {
      const day = Math.floor(index / 3) + 1, date = `${t.month}-${String(day).padStart(2, '0')}`;
      if (known(date, t.close) || !wanted(date, t.close)) continue;
      row.forEach((gl, c) => {
        const r = readCell(gl, samples, maxDist);
        if (r.empty) return;
        results.push({date, close: t.close, rank: ranks[c], k: index % 3, value: r.margin >= minMargin ? r.value : null, margin: +r.margin.toFixed(2), image: t.key});
      });
    }
  }
  return {results, images};
}

// Groups accepted cell values into rows; a rank is kept only with all three values confident and rising.
export function rowsFromResults(results, sourceURLFor) {
  const byKey = new Map();
  for (const r of results) {
    const key = r.date + '|' + r.close + '|' + r.rank, e = byKey.get(key) ?? {date: r.date, close: r.close, rank: r.rank, vals: [undefined, undefined, undefined], images: new Set()};
    e.vals[r.k] = r.value; e.images.add(r.image); byKey.set(key, e);
  }
  const rows = new Map(), rejected = [];
  for (const e of byKey.values()) {
    const v = e.vals;
    if (v.some(x => x === null || x === undefined) || !(v[0] > 0 && v[0] <= v[1] && v[1] <= v[2])) { rejected.push({date: e.date, close: e.close, rank: e.rank, vals: v}); continue; }
    const key = e.date + '|' + e.close, row = rows.get(key) ?? {date: e.date, close: e.close, ranks: {}, sourceURL: sourceURLFor(e.date, e.close), images: new Set()};
    row.ranks[e.rank] = v; e.images.forEach(i => row.images.add(i)); rows.set(key, row);
  }
  return {rows: [...rows.values()].map(r => ({...r, images: [...r.images]})), rejected};
}
