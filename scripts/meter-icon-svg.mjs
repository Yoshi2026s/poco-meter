// Source of the home-screen / favicon icon (a meter gauge, blue x black).
// Usage: node scripts/meter-icon-svg.mjs > calculator/meter-icon.svg
// PNGs in calculator/offline-assets.mjs are rendered from this SVG (see README).
// Important shapes stay inside the maskable safe zone (radius 40% of the canvas).
const S = 512, CX = 256, CY = 278, R = 150, W = 46;
const START = 135, SWEEP = 270;
const VALUE = 0.72;   // needle position
const TARGET = 0.86;  // gold target mark
const rad = d => d * Math.PI / 180;
const pt = (deg, r) => [CX + r * Math.cos(rad(deg)), CY + r * Math.sin(rad(deg))].map(n => +n.toFixed(2));
function arc(from, to, r) {
  const [x1, y1] = pt(from, r), [x2, y2] = pt(to, r);
  return `M${x1} ${y1}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}
const angle = f => START + SWEEP * f;

export function meterIconSVG() {
  const ticks = [];
  for (let i = 0; i <= 10; i++) {
    const a = angle(i / 10), major = i % 5 === 0;
    const [x1, y1] = pt(a, R - W / 2 - 14), [x2, y2] = pt(a, R - W / 2 - (major ? 40 : 28));
    ticks.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#9FC9FF" stroke-opacity="${major ? 0.9 : 0.55}" stroke-width="${major ? 9 : 6}" stroke-linecap="round"/>`);
  }
  const [tx1, ty1] = pt(angle(TARGET), R - W / 2 - 4), [tx2, ty2] = pt(angle(TARGET), R + W / 2 + 4);
  const [nx, ny] = pt(angle(VALUE), R - W / 2 - 20);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1630"/><stop offset="1" stop-color="#050A16"/></linearGradient>
<linearGradient id="fill" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#1E78D6"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.55" r="0.5"><stop offset="0" stop-color="#1E78D6" stop-opacity="0.35"/><stop offset="1" stop-color="#1E78D6" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${S}" height="${S}" fill="url(#bg)"/>
<circle cx="${CX}" cy="${CY}" r="${R + 60}" fill="url(#glow)"/>
<path d="${arc(START, START + SWEEP, R)}" fill="none" stroke="#1A2A47" stroke-width="${W}" stroke-linecap="round"/>
<path d="${arc(START, angle(VALUE), R)}" fill="none" stroke="url(#fill)" stroke-width="${W}" stroke-linecap="round"/>
${ticks.join('\n')}
<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="#FFC233" stroke-width="12" stroke-linecap="round"/>
<line x1="${CX}" y1="${CY}" x2="${nx}" y2="${ny}" stroke="#FFFFFF" stroke-width="16" stroke-linecap="round"/>
<circle cx="${CX}" cy="${CY}" r="30" fill="#FFFFFF"/>
<circle cx="${CX}" cy="${CY}" r="13" fill="#1E78D6"/>
</svg>
`;
}

if (process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('scripts/meter-icon-svg.mjs')) process.stdout.write(meterIconSVG());
