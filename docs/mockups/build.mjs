// Builds the README feature mockups: `node docs/mockups/build.mjs`.
// Each is a self-contained SVG that follows the reader's light or dark theme.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const W = 960;
const H = 520;

// Lucide icons (24 x 24, stroked), plus the plugin's own.
const ICONS = {
  pointer: ['<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>'],
  card: ['<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/>', '<path d="M15 3v4a2 2 0 0 0 2 2h4"/>'],
  note: ['<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>', '<path d="M14 2v4a2 2 0 0 0 2 2h4"/>', '<path d="M10 9H8"/>', '<path d="M16 13H8"/>', '<path d="M16 17H8"/>'],
  media: ['<rect x="3" y="3" width="18" height="18" rx="2"/>', '<circle cx="9" cy="9" r="2"/>', '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'],
  types: ['<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.7.7l3.6 3.6A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2Z"/>', '<path d="M14 2v5a1 1 0 0 0 1 1h5"/>', '<path d="M9 13H8M9 17H8M12.5 13h-1M12.5 17h-1M16 13h-1M16 17h-1"/>'],
  text: ['<path d="M12 4v16"/>', '<path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/>', '<path d="M9 20h6"/>'],
  group: ['<path d="M22 6H2M22 18H2M6 2v20M18 2v20"/>'],
  anchor: ['<path d="M12 22V8"/>', '<path d="M5 12H2a10 10 0 0 0 20 0h-3"/>', '<circle cx="12" cy="5" r="3"/>'],
  marker: ['<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>', '<path d="m15 5 4 4"/>'],
  highlighter: ['<path d="m9 11-6 6v3h9l3-3"/>', '<path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'],
  eraser: ['<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.828 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/>', '<path d="m5.082 11.09 8.828 8.828"/>'],
  present: ['<path d="M2 3h20"/>', '<path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/>', '<path d="m7 21 5-5 5 5"/>'],
  panel: ['<path d="M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9.35"/>', '<path d="M14 19h6M17 16v6"/>'],
  left: ['<path d="m15 18-6-6 6-6"/>'],
  right: ['<path d="m9 18 6-6-6-6"/>'],
  down: ['<path d="m6 9 6 6 6-6"/>'],
  x: ['<path d="M18 6 6 18M6 6l12 12"/>'],
  search: ['<circle cx="11" cy="11" r="8"/>', '<path d="m21 21-4.3-4.3"/>'],
  globe: ['<circle cx="12" cy="12" r="10"/>', '<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>'],
  pencil: ['<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>'],
  plus: ['<path d="M5 12h14M12 5v14"/>'],
  minus: ['<path d="M5 12h14"/>'],
  help: ['<circle cx="12" cy="12" r="10"/>', '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>'],
  hide: ['<path d="m2 2 20 20"/>', '<path d="M10.7 5.1A10.7 10.7 0 0 1 21.9 11.7a1 1 0 0 1 0 .7 10.7 10.7 0 0 1-1.4 2.5M14.1 14.2a3 3 0 0 1-4.2-4.2M17.5 17.5a10.8 10.8 0 0 1-15.4-5.2 1 1 0 0 1 0-.7 10.8 10.8 0 0 1 4.4-5.1"/>'],
  filter: ['<path d="M3 6h18M7 12h10M10 18h4"/>'],
  more: ['<circle cx="12" cy="12" r="1"/>', '<circle cx="19" cy="12" r="1"/>', '<circle cx="5" cy="12" r="1"/>'],
  check: ['<path d="M20 6 9 17l-5-5"/>'],
  settings: ['<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>', '<circle cx="12" cy="12" r="3"/>'],
  reset: ['<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>', '<path d="M21 3v5h-5"/>'],
  fit: ['<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>'],
  undo: ['<path d="M9 14 4 9l5-5"/>', '<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'],
  redo: ['<path d="m15 14 5-5-5-5"/>', '<path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'],
  layers: ['<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>', '<path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>', '<path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>'],
  map: ['<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/>', '<path d="M15 5.764v15M9 3.236v15"/>'],
  book: ['<path d="M12 7v14"/>', '<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>'],
  back: ['<path d="m12 19-7-7 7-7M19 12H5"/>'],
  fwd: ['<path d="M5 12h14M12 5l7 7-7 7"/>'],
  sidebar: ['<rect width="18" height="18" x="3" y="3" rx="2"/>', '<path d="M9 3v18"/>'],
  comment: ['<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>'],
  tray: ['<path d="M22 12h-6l-2 3h-4l-2-3H2"/>', '<path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'],
  command: ['<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>'],
  workflow: ['<rect width="8" height="8" x="3" y="3" rx="2"/>', '<path d="M7 11v4a2 2 0 0 0 2 2h4"/>', '<rect width="8" height="8" x="13" y="13" rx="2"/>'],
  puzzle: ['<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>'],
  filecode: ['<path d="M10 12.5 8 15l2 2.5"/>', '<path d="m14 12.5 2 2.5-2 2.5"/>', '<path d="M14 2v4a2 2 0 0 0 2 2h4"/>', '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/>'],
  link: ['<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>', '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'],
  star: ['<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>'],
  cube: ['<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/>', '<path d="M12 22V12"/>', '<path d="m3.3 7 8.7 5 8.7-5"/>'],
  trash: ['<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'],
  palette: ['<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/>', '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/>'],
  edit: ['<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>', '<path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>'],
  signpost: ['<path d="M12 13v8M12 3v3"/>', '<path d="M18 6H5a1 1 0 0 0-.92.6l-.6 1.4a1 1 0 0 0 .2 1.1l.7.7a1 1 0 0 0 .7.3H18a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z"/>'],
  expand: ['<path d="m21 21-6-6m6 6v-4.8m0 4.8h-4.8"/>', '<path d="M3 16.2V21m0 0h4.8M3 21l6-6"/>', '<path d="M21 7.8V3m0 0h-4.8M21 3l-6 6"/>', '<path d="M3 7.8V3m0 0h4.8M3 3l6 6"/>'],
  clock: ['<circle cx="12" cy="12" r="10"/>', '<path d="M12 6v6l4 2"/>'],
  grip: ['<circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/>'],
};

const STYLE = `
  text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
  .bg { fill: #ffffff; } .dot { fill: #e3e3e8; }
  .surface { fill: #ffffff; stroke: #d8d8de; stroke-width: 1.2; }
  .surface-alt { fill: #f3f3f6; stroke: #e2e2e8; stroke-width: 1; }
  .fill-surface { fill: #ffffff; } .fill-alt { fill: #f3f3f6; } .fill-hover { fill: #ececf1; }
  .line { stroke: #e2e2e8; fill: none; } .line-strong { stroke: #b9b9c4; fill: none; }
  .t { fill: #222228; } .tm { fill: #6c6c78; } .tf { fill: #a2a2ae; }
  .bar-t { fill: #dcdce3; } .bar-f { fill: #ececf1; }
  .c { color: #222228; } .cm { color: #6c6c78; } .cf { color: #a2a2ae; } .ca { color: #7655f0; }
  .a { fill: #7655f0; } .as { stroke: #7655f0; fill: none; } .asoft { fill: #7655f0; fill-opacity: .1; }
  .on-a { fill: #ffffff; }
  .ink-red { stroke: #e93147; } .ink-green { stroke: #08b94e; }
  .hl-yellow { stroke: #f5c400; stroke-opacity: .38; }
  .shadow { flood-color: #1b1b30; flood-opacity: .08; }
  .gfill { fill: #ffffff; fill-opacity: .6; }
  .o-c { color: #a8461a; } .o-fill { fill: #f6e5dc; stroke: #d9a184; stroke-width: 1.2; } .o-t { fill: #a8461a; }
  .chrome { fill: #ececf0; } .ribbon { fill: #f6f6f8; } .ink-dark { stroke: #222228; }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #1e1e1e; } .dot { fill: #333338; }
    .surface { fill: #26262a; stroke: #36363c; }
    .surface-alt { fill: #2d2d32; stroke: #36363c; }
    .fill-surface { fill: #26262a; } .fill-alt { fill: #2d2d32; } .fill-hover { fill: #34343a; }
    .line { stroke: #36363c; } .line-strong { stroke: #55555e; }
    .t { fill: #e4e4e9; } .tm { fill: #a0a0ab; } .tf { fill: #6d6d78; }
    .bar-t { fill: #3e3e45; } .bar-f { fill: #33333a; }
    .c { color: #e4e4e9; } .cm { color: #a0a0ab; } .cf { color: #6d6d78; } .ca { color: #9b83ff; }
    .a { fill: #8f76ff; } .as { stroke: #8f76ff; } .asoft { fill: #8f76ff; fill-opacity: .16; }
    .on-a { fill: #ffffff; }
    .hl-yellow { stroke-opacity: .3; }
    .shadow { flood-color: #000000; flood-opacity: .35; }
    .gfill { fill: #ffffff; fill-opacity: .025; }
    .o-fill { fill: #3a2a22; stroke: #8a5235; } .o-t { fill: #f0a274; } .o-c { color: #f0a274; }
    .chrome { fill: #161618; } .ribbon { fill: #1a1a1c; } .ink-dark { stroke: #e4e4e9; }
  }
  .ic { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
`;

/** Shared definitions, with only the icons that `body` uses. */
function defs(w, h, body) {
  const symbols = Object.entries(ICONS)
    .filter(([id]) => body.includes(`#i-${id}"`))
    .map(([id, parts]) => `<symbol id="i-${id}" viewBox="0 0 24 24" class="ic">${parts.join('')}</symbol>`)
    .join('');
  return `<defs>
    ${symbols}
    <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" class="dot"/></pattern>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="8" class="shadow"/></filter>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9c7ff"/><stop offset="1" stop-color="#e9d8ff"/></linearGradient>
    <linearGradient id="dusk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd1b3"/><stop offset="1" stop-color="#f6a8c4"/></linearGradient>
    <clipPath id="frame"><rect width="${w}" height="${h}" rx="14"/></clipPath>
  </defs>`;
}

function svg(title, body, w = W, h = H) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}">
<title>${title}</title>
<style>${STYLE}</style>
${defs(w, h, body)}
<g clip-path="url(#frame)">
  <rect width="${w}" height="${h}" class="bg"/>
  <rect width="${w}" height="${h}" fill="url(#dots)"/>
  ${body}
</g>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="14" class="line"/>
</svg>
`;
}

// ---------- primitives ----------

const icon = (name, x, y, size = 18, cls = 'cm') =>
  `<use href="#i-${name}" x="${x}" y="${y}" width="${size}" height="${size}" class="${cls}"/>`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const text = (x, y, s, { size = 13, cls = 't', weight = 400, anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" class="${cls}">${esc(s)}</text>`;

const box = (x, y, w, h, { r = 10, cls = 'surface', shadow = false } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" class="${cls}"${shadow ? ' filter="url(#sh)"' : ''}/>`;

/** Placeholder text lines, as soft bars. */
const lines = (x, y, widths, { gap = 14, h = 6, cls = 'bar-t' } = {}) =>
  widths.map((w, i) => `<rect x="${x}" y="${y + i * gap}" width="${w}" height="${h}" rx="${h / 2}" class="${cls}"/>`).join('');

/** A plain canvas card: title plus a few text lines. */
function card(x, y, w, h, title, widths = [w - 60, w - 90, w - 120], { selected = false } = {}) {
  return `${box(x, y, w, h, { r: 8 })}
    ${selected ? `<rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="12" class="as" stroke-width="2"/>` : ''}
    ${text(x + 16, y + 28, title, { size: 14, weight: 600 })}
    ${lines(x + 16, y + 44, widths)}`;
}

/** A core group: outline with its label above. */
function group(x, y, w, h, label, { size = 17 } = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" class="gfill"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" class="line-strong" stroke-width="1.2"/>
    ${text(x + 4, y - 10, label, { size, cls: 'tm', weight: 400 })}`;
}

/** A core file node coloured orange, with its name above as core shows it. */
function fileCard(x, y, w, h, title, { label = title, size = 14 } = {}) {
  return `${text(x, y - 9, label, { size: 12.5, cls: 'tf' })}
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" class="o-fill"/>
    ${icon('cube', x + 11, y + h / 2 - 6, 12, 'o-c')}
    ${text(x + 29, y + h / 2 + size * .35, title, { size, cls: 'o-t', weight: 650 })}`;
}

/** Core's controls on the right, as stacked button groups. */
function controls(x, y, active) {
  const groups = [['settings'], ['plus', 'reset', 'fit', 'minus'], ['undo', 'redo'], ['panel'], ['help']];
  const s = 40;
  let out = '';
  groups.forEach((g) => {
    out += box(x, y, s, g.length * s, { r: 8, shadow: true });
    g.forEach((id, i) => {
      if (id === active) out += `<rect x="${x + 4}" y="${y + i * s + 4}" width="${s - 8}" height="${s - 8}" rx="6" class="asoft"/>`;
      out += icon(id, x + 11, y + i * s + 11, 18, id === active ? 'ca' : id === 'redo' ? 'cf' : 'cm');
    });
    y += g.length * s + 8;
  });
  return out;
}

/** An anchor: its icon, with its name above. */
const anchor = (x, y, name) =>
  `${icon('anchor', x, y, 20, 'ca')}${text(x + 10, y - 9, name, { size: 12.5, cls: 'tf', anchor: 'middle' })}`;

/** Tool bar from groups of tools. Returns markup and the x of each tool by id. */
function toolbar(cx, y, groups, active, size = 40) {
  const gap = 2, sep = 13, pad = 6, is = Math.round(size * .56);
  let w = pad * 2;
  groups.forEach((g, i) => { w += g.length * size + (g.length - 1) * gap + (i ? sep : 0); });
  let x = cx - w / 2 + pad;
  const pos = {};
  let out = box(cx - w / 2, y, w, size + pad * 2, { r: 12, shadow: true });
  groups.forEach((g, gi) => {
    if (gi) {
      out += `<line x1="${x + sep / 2 - gap / 2}" y1="${y}" x2="${x + sep / 2 - gap / 2}" y2="${y + size + pad * 2}" class="line" stroke-width="1"/>`;
      x += sep;
    }
    g.forEach((id) => {
      pos[id] = x + size / 2;
      if (id === active && id !== 'pointer') out += `<rect x="${x}" y="${y + pad}" width="${size}" height="${size}" rx="8" class="asoft"/>`;
      out += icon(id, x + (size - is) / 2, y + pad + (size - is) / 2, is, id === active ? 'ca' : 'cm');
      x += size + gap;
    });
  });
  return { out, pos, w };
}

const TOOLS = [['pointer'], ['card', 'note', 'media', 'types', 'puzzle'], ['text', 'group', 'anchor', 'comment', 'marker', 'highlighter', 'eraser'], ['tray', 'command']];

/** A small tooltip-style label centred on x, sitting above y. */
function tip(x, y, label, key) {
  const w = label.length * 7 + (key ? key.length * 7 + 22 : 0) + 20;
  return `${box(x - w / 2, y - 30, w, 26, { r: 7, cls: 'surface', shadow: true })}
    ${text(x - w / 2 + 10, y - 12.5, label, { size: 12, weight: 500 })}
    ${key ? `<rect x="${x + w / 2 - key.length * 7 - 18}" y="${y - 25}" width="${key.length * 7 + 10}" height="16" rx="4" class="fill-hover"/>${text(x + w / 2 - 13, y - 13, key, { size: 11, cls: 'tm', anchor: 'end' })}` : ''}`;
}

const cursor = (x, y) =>
  `<path d="M${x} ${y}l0 17l4.5-4.2l3 6.6l2.6-1.2l-3-6.4l6.1-.3z" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>`;

const crosshair = (x, y) =>
  `<g stroke="#111" stroke-width="3" stroke-linecap="round" opacity=".9"><path d="M${x - 8} ${y}h16M${x} ${y - 8}v16"/></g>
   <g stroke="#fff" stroke-width="1.2" stroke-linecap="round"><path d="M${x - 7} ${y}h14M${x} ${y - 7}v14"/></g>`;

/** Key image placeholder: soft gradient with hills. */
function keyImage(x, y, w, h, grad = 'sky', r = 8) {
  const id = `ki${x}${y}`;
  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>
    <g clip-path="url(#${id})">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${grad})"/>
      <circle cx="${x + w * .76}" cy="${y + h * .34}" r="${h * .12}" fill="#fff" opacity=".7"/>
      <path d="M${x} ${y + h}L${x + w * .3} ${y + h * .5}L${x + w * .5} ${y + h * .75}L${x + w * .7} ${y + h * .45}L${x + w} ${y + h * .85}V${y + h}Z" fill="#fff" opacity=".45"/>
    </g>`;
}

const pill = (x, y, label, { cls = 'asoft', tcls = 'a', size = 11 } = {}) => {
  const w = label.length * size * 0.6 + 16;
  return `<rect x="${x}" y="${y}" width="${w}" height="${size + 9}" rx="${(size + 9) / 2}" class="${cls}"/>${text(x + w / 2, y + size + 2.5, label, { size, cls: tcls, weight: 600, anchor: 'middle' })}`;
};

/** Obsidian's view header: back and forward, the title, and the view's buttons. */
function viewHeader(w, y, title, presenting = false) {
  return `<rect y="${y}" width="${w}" height="44" class="fill-surface"/>
    <line x1="0" y1="${y + 44}" x2="${w}" y2="${y + 44}" class="line"/>
    ${icon('back', 18, y + 13, 18, 'cf')}${icon('fwd', 46, y + 13, 18, 'cf')}
    ${text(80, y + 27, title, { size: 14, weight: 500 })}
    ${presenting ? `<rect x="${w - 84}" y="${y + 7}" width="30" height="30" rx="7" class="asoft"/>` : ''}
    ${icon('present', w - 78, y + 13, 18, presenting ? 'ca' : 'cm')}
    ${icon('more', w - 42, y + 13, 18, 'cm')}`;
}

/** A note card with a key image on top and its title below. */
function imageCard(x, y, w, h, title, grad = 'sky') {
  return `${box(x, y, w, h, { r: 8, shadow: true })}
    ${keyImage(x + 8, y + 8, w - 16, h - 52, grad, 5)}
    ${text(x + 12, y + h - 17, title, { size: 14, weight: 600 })}`;
}


/** Obsidian's own window around a scene: tabs, ribbon, view header, canvas controls and status bar. */
const L = 40, T = 82;
function app(title, body, { header = true, extras = true, bar = 'pointer', controlsOn = true, layersBtn = true, minimapBtn = true, w = W, h = H } = {}) {
  const tabs = ['Dashboard', 'Meeting notes', 'Roadmap'];
  let tabMarkup = '';
  tabs.forEach((t, i) => { tabMarkup += text(L + 40 + i * 132 + 8, 26, t, { size: 12.5, cls: 'tm' }) + (i ? `<line x1="${L + 40 + i * 132 - 8}" y1="13" x2="${L + 40 + i * 132 - 8}" y2="27" class="line-strong"/>` : ''); });
  const ax = L + 40 + tabs.length * 132;
  const ribbonIcons = ['search', 'book', 'card', 'types', 'map', 'layers', 'star', 'link', 'settings'];
  const chrome = `
    <rect width="${L + w}" height="40" class="chrome"/>
    <circle cx="22" cy="20" r="6" fill="#ff5f57"/><circle cx="42" cy="20" r="6" fill="#febc2e"/><circle cx="62" cy="20" r="6" fill="#28c840"/>
    ${tabMarkup}
    <path d="M${ax - 14} 40v-26a8 8 0 0 1 8-8h120a8 8 0 0 1 8 8v26z" class="fill-surface"/>
    ${icon('group', ax, 14, 14, 'cm')}${text(ax + 22, 26.5, 'Main', { size: 12.5, weight: 500 })}${icon('x', ax + 100, 15, 13, 'cm')}
    ${icon('plus', ax + 150, 14, 15, 'cm')}
    <rect y="40" width="${L}" height="${T - 40 + h}" class="ribbon"/>
    <line x1="${L}" y1="40" x2="${L}" y2="${T + h}" class="line"/>
    ${ribbonIcons.map((n, i) => icon(n, 11, T + 14 + i * 36, 18, 'cm')).join('')}
    ${header ? `<rect x="${L}" y="40" width="${w}" height="${T - 40}" class="fill-surface"/>
    <line x1="${L}" y1="${T}" x2="${L + w}" y2="${T}" class="line"/>
    ${icon('back', L + 18, 51, 18, 'cf')}${icon('fwd', L + 46, 51, 18, 'cf')}${text(L + 80, 66, 'Main', { size: 14, weight: 500 })}
    ${icon('expand', L + w - 150, 52, 17, 'cm')}${icon('present', L + w - 114, 51, 18, 'cm')}${icon('star', L + w - 78, 52, 17, 'cm')}${icon('more', L + w - 42, 51, 18, 'cm')}` : ''}`;
  const overlay = extras ? `
    ${controlsOn ? controls(w - 58, 16) : ''}
    ${layersBtn ? `${box(12, 12, 36, 36, { r: 8, shadow: true })}${icon('layers', 21, 21, 18, 'cm')}` : ''}
    ${minimapBtn ? `${box(12, h - 48, 36, 36, { r: 8, shadow: true })}${icon('map', 21, h - 39, 18, 'cm')}` : ''}
    ${text(w - 224, h - 12, '0 backlinks', { size: 12, cls: 'tm' })}${text(w - 70, h - 12, 'Home', { size: 12, cls: 'tm' })}
    ${bar ? toolbar(w / 2, h - 80, TOOLS, bar).out : ''}` : '';
  return svg(title, `<g transform="translate(${L},${T})">${body}${overlay}</g>${chrome}`, L + w, T + h);
}

// ---------- scenes ----------

const scenes = {};

scenes.tools = () => {
  const bar = toolbar(W / 2, H - 80, TOOLS, 'group');
  return app('Canvas Plus tool bar placing a group', `
    ${text(150, 120, 'Launch plan', { size: 30, weight: 700 })}
    ${text(152, 148, 'Free text, no card chrome', { size: 14, cls: 'tm' })}
    <rect x="128" y="176" width="510" height="158" rx="12" class="asoft"/>
    ${card(150, 196, 210, 112, 'Brief', [170, 150, 120])}
    ${card(390, 196, 210, 112, 'Audience', [160, 170, 90])}
    <rect x="128" y="176" width="510" height="158" rx="12" class="as" stroke-width="1.5" stroke-dasharray="6 5"/>
    ${crosshair(638, 334)}
    ${anchor(720, 160, 'Anchor 1')}
    <rect x="690" y="186" width="160" height="110" rx="10" class="line-strong" stroke-dasharray="4 4" stroke-width="1.2"/>
    ${lines(712, 214, [110, 80, 96], { gap: 16, cls: 'bar-f' })}
    ${bar.out}
    ${tip(bar.pos.group, H - 82, 'Group', 'G')}
  `, { bar: null });
};

scenes.ink = () => {
  const bar = toolbar(W / 2, H - 80, TOOLS, 'marker');
  const colors = ['#e93147', '#ec7500', '#e0ac00', '#08b94e', '#00bfbc', '#7852ee'];
  const rowW = 7 * 26 + 16;
  const rx = bar.pos.marker - rowW / 2, ry = H - 128;
  let swatches = `<circle cx="${rx + 21}" cy="${ry + 20}" r="8" class="line-strong" stroke-width="1.5"/><path d="M${rx + 15.5} ${ry + 25.5}l11-11" class="line-strong" stroke-width="1.5"/>`;
  colors.forEach((c, i) => {
    const cx = rx + 21 + (i + 1) * 26;
    if (i === 0) swatches += `<circle cx="${cx}" cy="${ry + 20}" r="11.5" fill="none" stroke="${c}" stroke-width="2"/>`;
    swatches += `<circle cx="${cx}" cy="${ry + 20}" r="8" fill="${c}"/>`;
  });
  return app('Marker and highlighter strokes on a canvas', `
    ${text(170, 112, 'Sprint review', { size: 30, weight: 700 })}
    <path d="M164 104 C 250 100, 340 102, 392 101" class="hl-yellow" stroke-width="22" stroke-linecap="round" fill="none"/>
    ${card(170, 160, 220, 116, 'Shipped', [180, 150, 110])}
    ${card(540, 140, 220, 116, 'Blocked', [170, 140, 120])}
    <path d="M525 128 C 500 190, 560 282, 660 276 C 770 270, 800 200, 772 150 C 750 112, 640 108, 560 120" class="ink-red" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    <path d="M402 230 C 440 250, 480 236, 516 208" class="ink-red" stroke-width="3.5" stroke-linecap="round" fill="none"/>
    <path d="M500 204 L 518 206 L 512 222" class="ink-red" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M190 312 l12 12 l26 -28" class="ink-green" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    ${box(rx, ry, rowW, 40, { r: 10, shadow: true })}
    ${swatches}
    ${bar.out}
  `, { bar: null });
};

scenes.layers = () => {
  const px = 16, py = 16, pw = 268, ph = H - 32;
  const rows = [
    { d: 0, ic: 'group', label: 'Research', open: true },
    { d: 1, ic: 'note', label: 'Interview notes' },
    { d: 1, ic: 'note', label: 'Survey results' },
    { d: 1, ic: 'anchor', label: 'Anchor 1', sel: true },
    { d: 0, ic: 'group', label: 'Design', open: true },
    { d: 1, ic: 'note', label: 'Wireframes' },
    { d: 1, ic: 'globe', label: 'Figma file', hover: true },
    { d: 0, ic: 'anchor', label: 'Anchor 2' },
  ];
  const favs = ['Wireframes', 'Anchor 1'];
  let list = `${icon('down', px + 12, py + 99, 14, 'cf')}${icon('star', px + 30, py + 97, 16, 'ca')}${text(px + 54, py + 110, 'Favorites', { size: 13, weight: 600 })}`;
  favs.forEach((f, i) => {
    const y = py + 124 + i * 30;
    if (i === 0) list += `<rect x="${px + 8}" y="${y - 4}" width="${pw - 16}" height="28" rx="6" class="fill-hover"/>${icon('x', px + pw - 34, y + 3, 14, 'cm')}`;
    list += icon(i ? 'anchor' : 'note', px + 34, y + 2, 16, 'cm') + text(px + 58, y + 15, f, { size: 13 });
  });
  list += `<line x1="${px + 12}" y1="${py + 192}" x2="${px + pw - 12}" y2="${py + 192}" class="line"/>`;
  rows.forEach((r, i) => {
    const y = py + 204 + i * 30;
    const x = px + 12 + r.d * 20;
    if (r.sel) list += `<rect x="${px + 8}" y="${y - 4}" width="${pw - 16}" height="28" rx="6" class="asoft"/>`;
    if (r.hover) list += `<rect x="${px + 8}" y="${y - 4}" width="${pw - 16}" height="28" rx="6" class="fill-hover"/>${icon('pencil', px + pw - 36, y + 3, 14, 'cm')}`;
    if (r.open) list += icon('down', x, y + 3, 14, 'cf');
    list += icon(r.ic, x + (r.d ? 4 : 18), y + 2, 16, r.sel ? 'ca' : 'cm');
    list += text(x + (r.d ? 28 : 42), y + 15, r.label, { size: 13, cls: r.sel ? 'a' : 't', weight: r.sel ? 600 : 400 });
  });
  return app('Layers panel with a favorites section, groups, anchors and notes', `
    ${group(420, 76, 300, 180, 'Research')}
    ${card(440, 96, 124, 76, 'Interviews', [80, 60])}
    ${card(578, 96, 124, 76, 'Survey', [70, 84])}
    <rect x="440" y="200" width="262" height="44" rx="8" class="as" stroke-width="1.5"/>
    ${text(442, 192, 'Anchor 1', { size: 12, cls: 'a', weight: 600 })}
    ${icon('anchor', 452, 212, 20, 'ca')}
    ${group(420, 316, 420, 150, 'Design')}
    ${card(440, 336, 150, 96, 'Wireframes', [100, 80, 110])}
    ${box(610, 336, 210, 40, { r: 10, shadow: true })}${icon('globe', 624, 347, 18, 'cm')}${text(650, 361, 'Figma file', { size: 13, weight: 500 })}
    ${anchor(782, 66, 'Anchor 2')}
    ${box(px, py, pw, ph, { r: 12, shadow: true })}
    ${text(px + 16, py + 32, 'Layers', { size: 15, weight: 700 })}
    ${box(px + 12, py + 50, pw - 70, 32, { r: 8, cls: 'surface-alt' })}
    ${icon('search', px + 22, py + 59, 14, 'cf')}${text(px + 44, py + 70.5, 'Search layers', { size: 12.5, cls: 'tf' })}
    ${box(px + pw - 52, py + 50, 40, 32, { r: 8, cls: 'surface-alt' })}${icon('filter', px + pw - 41, py + 58, 16, 'cm')}
    ${list}
  `, { layersBtn: false, minimapBtn: false, bar: null });
};

scenes.minimap = () => {
  // The whole canvas, in canvas units ([x, y, w, h, title], a group when title starts with '#'), and the part in view.
  const nodes = [
    [0, 0, 240, 160, '#'], [15, 20, 100, 60, 'a'], [125, 20, 100, 60, 'b'], [15, 90, 210, 55, 'c'], [40, 240, 180, 110, 'd'],
    [300, 20, 300, 170, '#Q4'], [315, 40, 135, 70, 'Sync'], [460, 40, 125, 70, 'Sharing'], [315, 120, 270, 55, 'Ink'],
    [640, 40, 170, 110, 'Risks'], [470, 215, 170, 72, 'Notes'], [680, 195, 140, 82, 'Launch'],
    [880, 40, 260, 240, '#'], [895, 60, 110, 80, 'e'], [1015, 60, 110, 80, 'f'], [895, 155, 230, 110, 'g'], [900, 320, 200, 90, 'h'],
  ];
  const view = [280, 0, 560, 303];
  const mx = 16, my = H - 16 - 150, mw = 236, mh = 150;
  const s = Math.min((mw - 24) / 1140, (mh - 24) / 410);
  const ox = mx + (mw - 1140 * s) / 2, oy = my + (mh - 410 * s) / 2;
  const isGroup = (t) => t.startsWith('#');
  const mini = nodes.map(([x, y, w, h, t]) =>
    `<rect x="${ox + x * s}" y="${oy + y * s}" width="${w * s}" height="${h * s}" rx="2" class="${isGroup(t) ? 'line-strong' : 'bar-t'}"${isGroup(t) ? ' stroke-width="1"' : ''}/>`).join('');
  // Main view: the canvas inside `view`, scaled to fill the frame.
  const k = W / view[2];
  const main = nodes.map(([x, y, w, h, t]) => {
    const X = (x - view[0]) * k, Y = (y - view[1]) * k;
    if (X + w * k < 0 || X > W || Y > H) return '';
    return isGroup(t)
      ? group(X, Y, w * k, h * k, t.slice(1))
      : card(X, Y, w * k, h * k, t, [w * k - 60, w * k - 100].slice(0, h > 60 ? 2 : 1));
  }).join('');
  return app('Minimap in the lower left, with a box for the part in view', `
    ${main}
    ${box(mx, my, mw, mh, { r: 12, shadow: true })}
    ${mini}
    <rect x="${ox + view[0] * s}" y="${oy + view[1] * s}" width="${view[2] * s}" height="${view[3] * s}" rx="3" class="asoft"/>
    <rect x="${ox + view[0] * s}" y="${oy + view[1] * s}" width="${view[2] * s}" height="${view[3] * s}" rx="3" class="as" stroke-width="1.5"/>
    ${icon('hide', mx + mw - 26, my + 8, 14, 'cf')}
    ${cursor(ox + (view[0] + view[2] * 0.62) * s, oy + (view[1] + view[3] * 0.55) * s)}
  `, { minimapBtn: false });
};

scenes.present = () => {
  const head = 44;
  const barW = 168, bx = W / 2 - barW / 2, by = H - 64;
  const stops = ['Intro', 'Q4 roadmap', 'Research', 'Design', 'Launch'];
  const mw = 200, mh = stops.length * 30 + 12, mx = W / 2 - mw / 2, my = by - mh - 10;
  let menu = box(mx, my, mw, mh, { r: 10, shadow: true });
  stops.forEach((s, i) => {
    const y = my + 6 + i * 30;
    if (i === 1) menu += `<rect x="${mx + 6}" y="${y}" width="${mw - 12}" height="28" rx="6" class="asoft"/>${icon('check', mx + mw - 30, y + 7, 14, 'ca')}`;
    menu += text(mx + 18, y + 19, String(i + 1), { size: 12, cls: 'tf', weight: 600 });
    menu += text(mx + 40, y + 19, s, { size: 13, cls: i === 1 ? 'a' : 't', weight: i === 1 ? 600 : 400 });
  });
  return app('Presenting a canvas stop by stop', `
    <rect width="${W}" height="${head}" class="fill-surface"/>
    <line x1="0" y1="${head}" x2="${W}" y2="${head}" class="line"/>
    ${viewHeader(W, 0, 'Roadmap', true)}
    ${text(96, 112, 'Q4 roadmap', { size: 34, weight: 700 })}
    ${text(98, 142, 'Three bets for the quarter', { size: 15, cls: 'tm' })}
    ${card(96, 170, 240, 108, 'Faster sync', [190, 160, 120, 140])}
    ${card(360, 170, 240, 108, 'Shared canvases', [180, 170, 100, 150])}
    ${card(624, 170, 240, 108, 'Mobile ink', [170, 190, 130, 90])}
    ${menu}
    ${box(bx, by, barW, 44, { r: 8, shadow: true })}
    <path d="M${bx + 48} ${by}v44M${bx + barW - 48} ${by}v44" class="line"/>
    ${icon('left', bx + 14, by + 12, 20, 'cm')}
    ${text(W / 2, by + 27, '2 / 5', { size: 14, weight: 500, anchor: 'middle' })}
    ${icon('right', bx + barW - 34, by + 12, 20, 'cm')}
  `, { header: false, extras: false });
};

scenes.panels = () => {
  const px = 470, py = 46, pw = 404, ph = 420;
  return app('A tab panel floating over the canvas', `
    ${group(48, 70, 360, 230, 'Kickoff')}
    ${card(68, 92, 150, 96, 'Agenda', [100, 80, 110])}
    ${card(238, 92, 150, 96, 'Attendees', [90, 110, 70])}
    ${card(68, 204, 320, 76, 'Decisions', [250, 200])}
    ${card(48, 340, 200, 100, 'Follow-ups', [150, 120, 90])}
    ${box(px, py, pw, ph, { r: 10, shadow: true })}
    ${icon('back', px + 16, py + 14, 17, 'cf')}${icon('fwd', px + 42, py + 14, 17, 'cf')}
    ${text(px + 76, py + 28, 'Meeting notes', { size: 14, weight: 500 })}
    ${icon('book', px + pw - 94, py + 14, 17, 'cm')}${icon('more', px + pw - 66, py + 14, 17, 'cm')}${icon('x', px + pw - 36, py + 14, 17, 'cm')}
    ${text(px + 32, py + 96, 'Meeting notes', { size: 26, weight: 700 })}
    ${lines(px + 32, py + 116, [320, 300, 220], { gap: 16, h: 7 })}
    ${text(px + 32, py + 190, 'Next steps', { size: 16, weight: 650 })}
    ${[0, 1, 2].map((i) => `<circle cx="${px + 38}" cy="${py + 214 + i * 22}" r="3" class="tm"/>${lines(px + 50, py + 211 + i * 22, [[210, 250, 170][i]], { h: 7 })}`).join('')}
    ${lines(px + 32, py + 300, [330, 290, 310, 180], { gap: 16, h: 7 })}
    <path d="M${px + pw - 8} ${py + ph - 20}L${px + pw - 20} ${py + ph - 8}M${px + pw - 8} ${py + ph - 13}L${px + pw - 13} ${py + ph - 8}" class="line-strong" stroke-width="1.5" stroke-linecap="round"/>
    ${controls(W - 58, 16, 'panel')}
  `, { controlsOn: false });
};

scenes.notetypes = () => {
  const a = { x: 70, y: 70, w: 250 }, b = { x: 450, y: 150, w: 230 };
  const props = (x, y, rows) => rows.map(([k, v], i) =>
    `${text(x, y + i * 22, k, { size: 12, cls: 'tm' })}${text(x + 76, y + i * 22, v, { size: 12, weight: 500 })}`).join('');
  const sx = 720, sy = 16, sw = W - sx - 16, sh = H - 32;
  const rel = [['Led by', 'Ana Ruiz'], ['Part of', 'Q4 roadmap'], ['Depends on', 'Sync engine']];
  return app('Typed notes as cards, with a relation on the edge between them', `
    ${box(a.x, a.y, a.w, 300, { r: 12, shadow: true })}
    <rect x="${a.x - 3}" y="${a.y - 3}" width="${a.w + 6}" height="306" rx="14" class="as" stroke-width="2"/>
    ${keyImage(a.x + 10, a.y + 10, a.w - 20, 130)}
    ${pill(a.x + 16, a.y + 156, 'Project')}
    ${text(a.x + 16, a.y + 202, 'Project Atlas', { size: 18, weight: 700 })}
    ${props(a.x + 16, a.y + 232, [['Status', 'Active'], ['Due', 'Dec 12'], ['Owner', 'Ana Ruiz']])}
    ${box(b.x, b.y, b.w, 200, { r: 12, shadow: true })}
    ${keyImage(b.x + 10, b.y + 10, b.w - 20, 80, 'dusk')}
    ${pill(b.x + 16, b.y + 104, 'Person')}
    ${text(b.x + 16, b.y + 148, 'Ana Ruiz', { size: 18, weight: 700 })}
    ${props(b.x + 16, b.y + 176, [['Team', 'Platform']])}
    <path d="M${a.x + a.w + 3} 250 C 390 250, 390 250, ${b.x - 6} 250" class="line-strong" stroke-width="2" fill="none"/>
    <path d="M${b.x - 14} 244 L${b.x - 4} 250 L${b.x - 14} 256" class="line-strong" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    ${box(347, 238, 76, 24, { r: 12, cls: 'surface' })}${text(385, 254.5, 'Led by', { size: 12, weight: 600, anchor: 'middle' })}
    ${box(sx, sy, sw, sh, { r: 12, shadow: true })}
    ${text(sx + 18, sy + 34, 'Relations', { size: 15, weight: 700 })}
    ${text(sx + 18, sy + 56, 'Project Atlas', { size: 12, cls: 'tm' })}
    ${rel.map(([k, v], i) => {
      const y = sy + 84 + i * 62;
      return `${text(sx + 18, y + 12, k.toUpperCase(), { size: 10.5, cls: 'tf', weight: 700 })}
        ${box(sx + 14, y + 20, sw - 28, 32, { r: 8, cls: 'surface-alt' })}
        ${icon('note', sx + 24, y + 28, 16, 'cm')}${text(sx + 48, y + 41, v, { size: 13, weight: 500 })}`;
    }).join('')}
  `, { controlsOn: false });
};

/** App badges as the actions panel and node toolbars show them. */
const appLogo = (x, y, kind, s = 18) =>
  kind === 'linear'
    ? `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="4" fill="#222228"/><circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s * .28}" fill="none" stroke="#fff" stroke-width="1.6"/>`
    : kind === 'taskapp'
      ? `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="4" fill="#4a47c8"/><rect x="${x + s * .25}" y="${y + s * .25}" width="${s * .5}" height="${s * .5}" rx="2" fill="#ff5f57"/>`
      : `<path d="M${x + s / 2} ${y}L${x + s} ${y + s / 2}L${x + s / 2} ${y + s}L${x} ${y + s / 2}Z" fill="#222228"/>`;

scenes.diagrams = () => {
  const cx = 150, cy = 112, cw = 560, ch = 290;
  const n = (x, y, w, label, { fill = 'surface-alt', h = 26 } = {}) =>
    `<rect x="${cx + x}" y="${cy + y}" width="${w}" height="${h}" rx="4" class="${fill}"/>${text(cx + x + w / 2, cy + y + h / 2 + 4, label, { size: 11, anchor: 'middle' })}`;
  const e = (d, dash = false) => `<path d="${d}" class="line-strong" stroke-width="1.2" fill="none"${dash ? ' stroke-dasharray="3 3"' : ''}/>`;
  const tb = ['trash', 'palette', 'search', 'edit', 'note', 'settings', 'signpost'];
  const tw = tb.length * 40 + 2 * 40 + 12, tx = cx + cw / 2 - tw / 2, ty = cy - 66;
  const dx = cx + 170, dy = cy + 150;
  return app('A flowchart diagram card selected on the canvas, with its toolbar', `
    ${box(tx, ty, tw, 48, { r: 10, shadow: true })}
    ${tb.map((id, i) => icon(id, tx + 12 + i * 40 + 8, ty + 14, 20, 'cm')).join('')}
    ${appLogo(tx + 12 + 7 * 40 + 10, ty + 15, 'linear', 20)}${appLogo(tx + 12 + 8 * 40 + 10, ty + 15, 'taskapp', 20)}
    ${box(cx, cy, cw, ch, { r: 8 })}
    <rect x="${cx - 3}" y="${cy - 3}" width="${cw + 6}" height="${ch + 6}" rx="10" class="as" stroke-width="2.5"/>
    ${e(`M${cx + 78} ${cy + 150} C ${cx + 100} ${cy + 150}, ${cx + 100} ${dy - cy + cy - 16}, ${cx + 118} ${dy - 16}`)}
    ${e(`M${cx + 78} ${cy + 150} C ${cx + 90} ${cy + 150}, ${cx + 96} ${cy + 100}, ${cx + 112} ${cy + 96}`)}
    ${e(`M${cx + 236} ${cy + 140} C ${cx + 270} ${cy + 140}, ${cx + 260} ${cy + 60}, ${cx + 316} ${cy + 60}`)}
    ${e(`M${cx + 236} ${cy + 146} C ${cx + 270} ${cy + 146}, ${cx + 270} ${cy + 126}, ${cx + 316} ${cy + 126}`)}
    ${e(`M${cx + 236} ${cy + 152} L ${cx + 316} ${cy + 188}`)}
    ${e(`M${cx + 236} ${cy + 158} C ${cx + 280} ${cy + 170}, ${cx + 290} ${cy + 240}, ${cx + 316} ${cy + 240}`, true)}
    ${e(`M${cx + 400} ${cy + 66} C ${cx + 440} ${cy + 66}, ${cx + 440} ${cy + 120}, ${cx + 470} ${cy + 120}`)}
    ${e(`M${cx + 400} ${cy + 132} L ${cx + 470} ${cy + 132}`)}
    ${n(26, 136, 52, 'Start')}
    ${n(112, 82, 110, 'New node')}
    <path d="M${cx + 180} ${cy + 124}L${cx + 236} ${cy + 152}L${cx + 180} ${cy + 180}L${cx + 124} ${cy + 152}Z" class="o-fill"/>${text(cx + 180, cy + 156, 'Decision', { size: 11, cls: 'o-t', anchor: 'middle' })}
    ${text(cx + 276, cy + 76, 'Yes', { size: 9.5, cls: 'tm' })}${text(cx + 276, cy + 118, 'No', { size: 9.5, cls: 'tm' })}
    ${n(316, 47, 84, 'Do it')}${n(316, 113, 84, 'Skip it')}${n(316, 175, 84, 'New node')}
    ${n(316, 227, 84, 'New node', { fill: 'asoft' })}
    ${n(470, 108, 70, 'Done')}
    ${n(470, 222, 70, 'New node')}
    ${cursor(cx + 440, cy + 262)}
  `);
};

scenes.actions = () => {
  const bar = toolbar(W / 2, H - 80, TOOLS, 'command');
  const pw = 440, ph = 360, px = bar.pos.command - pw + 70, py = H - 80 - ph - 10;
  const entries = [
    ['Linear'],
    ['Add Linear issue…', 'linear', 'I', true],
    ['Open Linear panel', 'panel'],
    ['Task App'],
    ['Add Task App issue…', 'taskapp', 'J'],
    ['Open Task App panel', 'panel'],
    ['Discourse Graphs'],
    ['Create discourse node…', 'dg'],
    ['Open discourse context panel', 'panel'],
    ['Canvas Plus'],
    ['Add diagram…', 'workflow', 'B'],
    ['Add widget…', 'puzzle'],
    ['Add HTML file…', 'filecode'],
  ];
  let y = py + 58, rows = '';
  entries.forEach(([label, ic, hint, sel]) => {
    if (!ic) { rows += text(px + 18, y + 14, label, { size: 13.5, cls: 'tm', weight: 500 }); y += 26; return; }
    if (sel) rows += `<rect x="${px + 10}" y="${y - 4}" width="${pw - 20}" height="32" rx="6" class="fill-hover"/>`;
    rows += (ic === 'linear' || ic === 'taskapp' || ic === 'dg') ? appLogo(px + 22, y + 3, ic, 17) : icon(ic, px + 22, y + 3, 17, 'cm');
    rows += text(px + 52, y + 18, label, { size: 13.5 });
    if (hint) rows += `<circle cx="${px + pw - 28}" cy="${y + 13}" r="10" class="fill-hover"/>${text(px + pw - 28, y + 17, hint, { size: 11, cls: 'tm', anchor: 'middle' })}`;
    y += 34;
  });
  return app('The actions panel: a searchable list of canvas actions', `
    ${card(70, 90, 200, 110, 'Brief', [150, 130, 90])}
    ${fileCard(330, 150, 190, 56, 'Obsidian Note Types', { label: 'Obsidian Note Types' })}
    <clipPath id="ap"><rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="12"/></clipPath>
    ${box(px, py, pw, ph, { r: 12, shadow: true })}
    <g clip-path="url(#ap)">
    ${text(px + 24, py + 36, 'Search actions', { size: 14.5, cls: 'tf' })}
    <line x1="${px}" y1="${py + 48}" x2="${px + pw}" y2="${py + 48}" class="line"/>
    ${rows}
    </g>
    ${bar.out}
  `, { bar: null });
};

scenes.embeds = () => {
  const html = { x: 60, y: 60, w: 330, h: 280 };
  const lp = { x: 450, y: 52, w: 400, h: 350 };
  const issues = [
    ['Refactor the import pipeline to use shared types…', 'ENG-2061 · In progress · Ana Ruiz', 'half-y'],
    ['Use the unified upsert in the sync worker…', 'ENG-1823 · In progress · Ana Ruiz', 'half-y'],
    ['Create a generic upsert route that accepts…', 'FEE-890 · Discovery · Sam Lee', 'dash'],
    ['Add a shared format resolver to the editor…', 'ENG-2207 · Ready for review · Ana Ruiz', 'half-g'],
    ['Publish the node type format as a package…', 'ENG-2208 · Ready for review · Ana Ruiz', 'half-g'],
  ];
  const status = (x, y, k) => k === 'dash'
    ? `<circle cx="${x}" cy="${y}" r="6.5" fill="none" stroke="#c9c9d2" stroke-width="2" stroke-dasharray="2.4 2.4"/>`
    : `<circle cx="${x}" cy="${y}" r="6.5" fill="none" stroke="${k === 'half-g' ? '#26b46b' : '#f2b01e'}" stroke-width="2"/><path d="M${x} ${y - 3}a3 3 0 0 1 0 6z" fill="${k === 'half-g' ? '#26b46b' : '#f2b01e'}"/>`;
  return app('An HTML page and the Linear widget running live as nodes on the canvas', `
    <rect x="${html.x}" y="${html.y}" width="${html.w}" height="${html.h}" rx="8" class="asoft"/>
    <rect x="${html.x}" y="${html.y}" width="${html.w}" height="${html.h}" rx="8" class="line-strong" stroke-width="1.2" fill="none"/>
    ${text(html.x + 20, html.y + 42, 'Hello from HTML', { size: 24, weight: 800 })}
    ${box(html.x + 20, html.y + 64, html.w - 40, 110, { r: 8 })}
    ${text(html.x + 36, html.y + 94, 'This page is rendered in a sandboxed', { size: 13 })}
    ${text(html.x + 36, html.y + 114, 'frame. Scripts run, so the counter below', { size: 13 })}
    ${text(html.x + 36, html.y + 134, 'works.', { size: 13 })}
    <rect x="${html.x + 36}" y="${html.y + 148}" width="76" height="24" rx="6" class="a"/>${text(html.x + 74, html.y + 164, '3 times', { size: 12, cls: 'on-a', weight: 600, anchor: 'middle' })}
    ${box(html.x + 20, html.y + 190, html.w - 40, 56, { r: 8 })}
    ${text(html.x + 36, html.y + 223, 'Time: 10:51:03 AM', { size: 13, weight: 700 })}
    ${cursor(html.x + 150, html.y + 150)}
    ${box(lp.x, lp.y, lp.w, lp.h, { r: 12, shadow: true })}
    ${icon('back', lp.x + 18, lp.y + 17, 16, 'cf')}${icon('fwd', lp.x + 44, lp.y + 17, 16, 'cf')}
    ${appLogo(lp.x + 76, lp.y + 15, 'linear', 20)}${text(lp.x + 104, lp.y + 31, 'Linear', { size: 14, weight: 500 })}
    ${icon('more', lp.x + lp.w - 64, lp.y + 17, 17, 'cm')}${icon('x', lp.x + lp.w - 34, lp.y + 17, 17, 'cm')}
    ${box(lp.x + 14, lp.y + 50, 126, 34, { r: 8, cls: 'surface-alt' })}${text(lp.x + 77, lp.y + 72, 'On canvas (0)', { size: 13, anchor: 'middle' })}
    <rect x="${lp.x + 148}" y="${lp.y + 50}" width="76" height="34" rx="8" class="a"/>${text(lp.x + 186, lp.y + 72, 'Explore', { size: 13, cls: 'on-a', weight: 600, anchor: 'middle' })}
    ${box(lp.x + 14, lp.y + 98, lp.w - 28, 34, { r: 17, cls: 'surface' })}${icon('search', lp.x + 28, lp.y + 107, 16, 'cm')}${text(lp.x + 54, lp.y + 120, 'Search Linear, or enter an identifier or URL', { size: 12.5, cls: 'tf' })}
    ${text(lp.x + 28, lp.y + 160, 'Recently updated', { size: 13, cls: 'tm', weight: 500 })}
    ${issues.map(([t, m, k], i) => {
      const y = lp.y + 176 + i * 34;
      return `${status(lp.x + 34, y + 12, k)}${text(lp.x + 56, y + 10, t, { size: 12.5, weight: 500 })}${text(lp.x + 56, y + 27, m, { size: 11, cls: 'tm' })}${icon('plus', lp.x + lp.w - 38, y + 4, 15, 'cf')}`;
    }).join('')}
  `);
};

scenes.hero = () => {
  const w = 1280, h = 800, top = 88;
  // Canvas content, in screen units. Groups start with '#'; the rest are drawn by hand below.
  const nodes = [
    [320, 230, 430, 230, '#'], [340, 280, 190, 64], [550, 280, 180, 64], [340, 370, 190, 64],
    [800, 230, 360, 230, '#'], [820, 270, 150, 160], [990, 280, 150, 64],
    [340, 568, 200, 60], [640, 540, 170, 150], [870, 578, 230, 110],
    // Off screen: only the minimap shows these.
    [1340, 200, 300, 260, '#'], [1360, 240, 120, 80], [1500, 240, 120, 80], [1360, 340, 260, 90],
    [1300, 560, 220, 120], [-120, 520, 160, 110], [500, 860, 340, 160, '#'], [520, 890, 140, 90], [680, 890, 140, 90],
  ];
  const bounds = [-140, 100, 1680, 1040];
  const mx = 16, mw = 248, mh = 150, my = h - 16 - mh;
  const s = Math.min((mw - 24) / (bounds[2] - bounds[0]), (mh - 24) / (bounds[3] - bounds[1]));
  const ox = mx + (mw - (bounds[2] - bounds[0]) * s) / 2 - bounds[0] * s;
  const oy = my + (mh - (bounds[3] - bounds[1]) * s) / 2 - bounds[1] * s;
  const mini = nodes.map(([x, y, nw, nh, k]) =>
    `<rect x="${ox + x * s}" y="${oy + y * s}" width="${nw * s}" height="${nh * s}" rx="1.5" class="${k ? 'line-strong' : 'bar-t'}"${k ? ' stroke-width="1"' : ''}/>`).join('');
  const vb = [ox, oy + top * s, w * s, (h - top) * s];

  const lp = { x: 16, y: top + 16, w: 248 };
  const rows = [
    { d: 0, ic: 'text', label: 'Product launch' },
    { d: 0, ic: 'group', label: 'Research', open: true },
    { d: 1, ic: 'note', label: 'User interviews' },
    { d: 1, ic: 'note', label: 'Survey results' },
    { d: 1, ic: 'note', label: 'Competitors' },
    { d: 1, ic: 'anchor', label: 'Kickoff' },
    { d: 0, ic: 'group', label: 'Design', open: true, sel: true },
    { d: 1, ic: 'note', label: 'Wireframes' },
    { d: 1, ic: 'note', label: 'Brand guide' },
    { d: 0, ic: 'note', label: 'Launch checklist' },
    { d: 0, ic: 'note', label: 'Moodboard' },
    { d: 0, ic: 'anchor', label: 'Retro' },
  ];
  const lh = 104 + rows.length * 30 + 8;
  let list = '';
  rows.forEach((r, i) => {
    const y = lp.y + 100 + i * 30;
    const x = lp.x + 10 + r.d * 20;
    if (r.sel) list += `<rect x="${lp.x + 8}" y="${y - 4}" width="${lp.w - 16}" height="27" rx="6" class="asoft"/>`;
    if (r.open) list += icon('down', x, y + 3, 13, 'cf');
    list += icon(r.ic, x + (r.d ? 4 : 17), y + 2, 15, r.sel ? 'ca' : 'cm');
    list += text(x + (r.d ? 27 : 40), y + 14, r.label, { size: 12.5, cls: r.sel ? 'a' : 't', weight: r.sel ? 600 : 400 });
  });

  const bar = toolbar(w / 2, h - 82, TOOLS, 'pointer', 40);
  return svg('Canvas Plus: tool bar, layers panel and minimap on an Obsidian canvas', `
    <!-- canvas content -->
    <path d="M314 160 C 420 156, 520 158, 590 157" class="hl-yellow" stroke-width="26" stroke-linecap="round" fill="none"/>
    ${text(320, 168, 'Product launch', { size: 34, weight: 700 })}
    ${text(322, 196, 'Everything for the December release', { size: 15, cls: 'tm' })}
    ${group(320, 250, 430, 210, 'Research')}
    ${fileCard(340, 300, 190, 60, 'User interviews')}
    ${fileCard(550, 300, 180, 60, 'Survey results')}
    ${fileCard(340, 388, 190, 60, 'Competitors')}
    ${anchor(626, 410, 'Kickoff')}
    ${group(800, 250, 380, 210, 'Design')}
    <rect x="797" y="247" width="386" height="216" rx="12" class="as" stroke-width="2"/>
    ${imageCard(820, 276, 160, 164, 'Wireframes')}
    ${fileCard(1000, 300, 160, 60, 'Brand guide')}
    ${text(1002, 412, 'Ship by Dec 12', { size: 13 })}
    ${pill(1098, 399, '#launch', { size: 11 })}
    <path d="M730 330 C 770 330, 770 330, 794 330" class="line-strong" stroke-width="2" fill="none"/>
    <path d="M786 324 l8 6 -8 6" class="line-strong" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M992 396 C 1040 384, 1150 384, 1166 404 C 1178 424, 1110 432, 1050 430 C 1000 428, 984 414, 996 398" class="ink-red" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    ${fileCard(340, 568, 200, 60, 'Launch checklist')}
    <path d="M556 600 l10 10 l22 -24" class="ink-green" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    ${imageCard(640, 540, 170, 150, 'Moodboard', 'dusk')}
    ${anchor(880, 548, 'Retro')}
    <rect x="870" y="578" width="230" height="110" rx="8" class="line-strong" stroke-dasharray="4 4" stroke-width="1.2"/>
    ${fileCard(890, 616, 190, 52, 'Retro notes')}

    <!-- window chrome -->
    <rect width="${w}" height="44" class="chrome"/>
    <circle cx="22" cy="22" r="6" fill="#ff5f57"/><circle cx="42" cy="22" r="6" fill="#febc2e"/><circle cx="62" cy="22" r="6" fill="#28c840"/>
    ${icon('sidebar', 86, 13, 18, 'cm')}
    <path d="M124 44v-30a8 8 0 0 1 8-8h176a8 8 0 0 1 8 8v30z" class="fill-surface"/>
    ${icon('group', 138, 16, 15, 'cm')}${text(162, 28.5, 'Roadmap', { size: 13, weight: 500 })}${icon('x', 290, 17, 14, 'cm')}
    ${text(336, 28.5, 'Meeting notes', { size: 13, cls: 'tm' })}
    <line x1="472" y1="16" x2="472" y2="30" class="line-strong"/>
    ${text(488, 28.5, 'New tab', { size: 13, cls: 'tm' })}
    ${viewHeader(w, 44, 'Roadmap')}

    <!-- layers panel -->
    ${box(lp.x, lp.y, lp.w, lh, { r: 12, shadow: true })}
    ${icon('layers', lp.x + 16, lp.y + 17, 16, 'c')}${text(lp.x + 40, lp.y + 30, 'Layers', { size: 14, weight: 700 })}
    ${box(lp.x + 12, lp.y + 48, lp.w - 66, 30, { r: 8, cls: 'surface-alt' })}
    ${icon('search', lp.x + 22, lp.y + 56, 14, 'cf')}${text(lp.x + 44, lp.y + 67.5, 'Search layers', { size: 12, cls: 'tf' })}
    ${box(lp.x + lp.w - 48, lp.y + 48, 36, 30, { r: 8, cls: 'surface-alt' })}${icon('filter', lp.x + lp.w - 38, lp.y + 55, 16, 'cm')}
    ${list}

    <!-- minimap -->
    ${box(mx, my, mw, mh, { r: 12, shadow: true })}
    ${mini}
    <rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" rx="2" class="asoft"/>
    <rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" rx="2" class="as" stroke-width="1.5"/>
    ${icon('hide', mx + mw - 24, my + 8, 13, 'cf')}

    ${controls(w - 58, top + 16)}
    ${bar.out}
  `, w, h);
};

for (const [name, make] of Object.entries(scenes)) {
  writeFileSync(join(OUT, `${name}.svg`), make());
}
console.log(`Wrote ${Object.keys(scenes).length} mockups to ${OUT}`);
