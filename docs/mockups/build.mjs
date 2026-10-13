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
  grip: ['<circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/>'],
};

const STYLE = `
  text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
  .bg { fill: #f6f6f8; } .dot { fill: #d6d6dd; }
  .surface { fill: #ffffff; stroke: #e2e2e8; stroke-width: 1; }
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
  @media (prefers-color-scheme: dark) {
    .bg { fill: #1c1c1f; } .dot { fill: #38383e; }
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
  }
  .ic { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
`;

function defs() {
  const symbols = Object.entries(ICONS)
    .map(([id, parts]) => `<symbol id="i-${id}" viewBox="0 0 24 24" class="ic">${parts.join('')}</symbol>`)
    .join('');
  return `<defs>
    ${symbols}
    <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" class="dot"/></pattern>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="8" class="shadow"/></filter>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9c7ff"/><stop offset="1" stop-color="#e9d8ff"/></linearGradient>
    <linearGradient id="dusk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd1b3"/><stop offset="1" stop-color="#f6a8c4"/></linearGradient>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="14"/></clipPath>
  </defs>`;
}

function svg(title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${title}">
<title>${title}</title>
<style>${STYLE}</style>
${defs()}
<g clip-path="url(#frame)">
  <rect width="${W}" height="${H}" class="bg"/>
  <rect width="${W}" height="${H}" fill="url(#dots)"/>
  ${body}
</g>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="14" class="line"/>
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
  return `${box(x, y, w, h, { r: 10, shadow: true })}
    ${selected ? `<rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="12" class="as" stroke-width="2"/>` : ''}
    ${text(x + 16, y + 28, title, { size: 14, weight: 600 })}
    ${lines(x + 16, y + 44, widths)}`;
}

/** A core group: outline with its label above. */
function group(x, y, w, h, label, { cls = 'line-strong', labelCls = 'tm' } = {}) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" class="${cls}" stroke-width="1.5"/>
    ${text(x + 4, y - 9, label, { size: 13, cls: labelCls, weight: 500 })}`;
}

/** An anchor: its icon, with its name above. */
const anchor = (x, y, name, cls = 'cm') =>
  `${icon('anchor', x, y, 20, cls)}${text(x + 10, y - 8, name, { size: 12, cls: cls === 'ca' ? 'a' : 'tm', weight: 500, anchor: 'middle' })}`;

/** Tool bar from groups of tools. Returns markup and the x of each tool by id. */
function toolbar(cx, y, groups, active) {
  const size = 34, gap = 2, sep = 13, pad = 6;
  let w = pad * 2;
  groups.forEach((g, i) => { w += g.length * size + (g.length - 1) * gap + (i ? sep : 0); });
  let x = cx - w / 2 + pad;
  const pos = {};
  let out = box(cx - w / 2, y, w, size + pad * 2, { r: 12, shadow: true });
  groups.forEach((g, gi) => {
    if (gi) {
      out += `<line x1="${x + sep / 2 - gap / 2}" y1="${y + 14}" x2="${x + sep / 2 - gap / 2}" y2="${y + size + pad * 2 - 14}" class="line" stroke-width="1"/>`;
      x += sep;
    }
    g.forEach((id) => {
      pos[id] = x + size / 2;
      if (id === active) out += `<rect x="${x}" y="${y + pad}" width="${size}" height="${size}" rx="8" class="asoft"/>`;
      out += icon(id, x + 8, y + pad + 8, 18, id === active ? 'ca' : 'cm');
      x += size + gap;
    });
  });
  return { out, pos, w };
}

const TOOLS = [['pointer'], ['card', 'note', 'media', 'types'], ['text', 'group', 'anchor', 'marker', 'highlighter', 'eraser']];

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

// ---------- scenes ----------

const scenes = {};

scenes.tools = () => {
  const bar = toolbar(W / 2, H - 76, TOOLS, 'group');
  return svg('Canvas Plus tool bar placing a group', `
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
  `);
};

scenes.ink = () => {
  const bar = toolbar(W / 2, H - 76, TOOLS, 'marker');
  const colors = ['#e93147', '#ec7500', '#e0ac00', '#08b94e', '#00bfbc', '#7852ee'];
  const rowW = 7 * 26 + 16;
  const rx = bar.pos.marker - rowW / 2, ry = H - 128;
  let swatches = `<circle cx="${rx + 21}" cy="${ry + 20}" r="8" class="line-strong" stroke-width="1.5"/><path d="M${rx + 15.5} ${ry + 25.5}l11-11" class="line-strong" stroke-width="1.5"/>`;
  colors.forEach((c, i) => {
    const cx = rx + 21 + (i + 1) * 26;
    if (i === 0) swatches += `<circle cx="${cx}" cy="${ry + 20}" r="11.5" fill="none" stroke="${c}" stroke-width="2"/>`;
    swatches += `<circle cx="${cx}" cy="${ry + 20}" r="8" fill="${c}"/>`;
  });
  return svg('Marker and highlighter strokes on a canvas', `
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
  `);
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
    { d: 0, ic: 'text', label: 'Launch plan' },
  ];
  let list = '';
  rows.forEach((r, i) => {
    const y = py + 112 + i * 32;
    const x = px + 12 + r.d * 20;
    if (r.sel) list += `<rect x="${px + 8}" y="${y - 4}" width="${pw - 16}" height="28" rx="6" class="asoft"/>`;
    if (r.hover) list += `<rect x="${px + 8}" y="${y - 4}" width="${pw - 16}" height="28" rx="6" class="fill-hover"/>${icon('pencil', px + pw - 36, y + 3, 14, 'cm')}`;
    if (r.open) list += icon('down', x, y + 3, 14, 'cf');
    list += icon(r.ic, x + (r.d ? 4 : 18), y + 2, 16, r.sel ? 'ca' : 'cm');
    list += text(x + (r.d ? 28 : 42), y + 15, r.label, { size: 13, cls: r.sel ? 'a' : 't', weight: r.sel ? 600 : 400 });
  });
  return svg('Layers panel listing groups, anchors and notes', `
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
  `);
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
  return svg('Minimap in the lower left, with a box for the part in view', `
    ${main}
    ${box(mx, my, mw, mh, { r: 12, shadow: true })}
    ${mini}
    <rect x="${ox + view[0] * s}" y="${oy + view[1] * s}" width="${view[2] * s}" height="${view[3] * s}" rx="3" class="asoft"/>
    <rect x="${ox + view[0] * s}" y="${oy + view[1] * s}" width="${view[2] * s}" height="${view[3] * s}" rx="3" class="as" stroke-width="1.5"/>
    ${icon('hide', mx + mw - 26, my + 8, 14, 'cf')}
    ${cursor(ox + (view[0] + view[2] * 0.62) * s, oy + (view[1] + view[3] * 0.55) * s)}
  `);
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
  return svg('Presenting a canvas stop by stop', `
    <rect width="${W}" height="${head}" class="fill-surface"/>
    <line x1="0" y1="${head}" x2="${W}" y2="${head}" class="line"/>
    ${icon('left', 16, 13, 18, 'cf')}${icon('right', 42, 13, 18, 'cf')}
    ${text(W / 2, 27, 'Roadmap', { size: 13, cls: 'tm', weight: 500, anchor: 'middle' })}
    <rect x="${W - 82}" y="7" width="30" height="30" rx="7" class="asoft"/>
    ${icon('present', W - 76, 13, 18, 'ca')}${icon('more', W - 40, 13, 18, 'cm')}
    ${text(96, 112, 'Q4 roadmap', { size: 34, weight: 700 })}
    ${text(98, 142, 'Three bets for the quarter', { size: 15, cls: 'tm' })}
    ${card(96, 170, 240, 108, 'Faster sync', [190, 160, 120, 140])}
    ${card(360, 170, 240, 108, 'Shared canvases', [180, 170, 100, 150])}
    ${card(624, 170, 240, 108, 'Mobile ink', [170, 190, 130, 90])}
    ${menu}
    ${box(bx, by, barW, 44, { r: 12, shadow: true })}
    ${icon('left', bx + 12, by + 12, 20, 'cm')}
    <rect x="${W / 2 - 34}" y="${by + 7}" width="68" height="30" rx="7" class="fill-hover"/>
    ${text(W / 2, by + 27, '2 / 5', { size: 14, weight: 600, anchor: 'middle' })}
    ${icon('right', bx + barW - 32, by + 12, 20, 'cm')}
  `);
};

scenes.panels = () => {
  const px = 470, py = 46, pw = 404, ph = 420;
  return svg('A tab panel floating over the canvas', `
    ${group(48, 70, 360, 230, 'Kickoff')}
    ${card(68, 92, 150, 96, 'Agenda', [100, 80, 110])}
    ${card(238, 92, 150, 96, 'Attendees', [90, 110, 70])}
    ${card(68, 204, 320, 76, 'Decisions', [250, 200])}
    ${card(48, 340, 200, 100, 'Follow-ups', [150, 120, 90])}
    ${box(px, py, pw, ph, { r: 12, shadow: true })}
    <path d="M${px} ${py + 12}a12 12 0 0 1 12-12h${pw - 24}a12 12 0 0 1 12 12v28h-${pw}z" class="fill-alt"/>
    <line x1="${px}" y1="${py + 40}" x2="${px + pw}" y2="${py + 40}" class="line"/>
    ${icon('left', px + 12, py + 11, 18, 'cm')}${icon('right', px + 36, py + 11, 18, 'cf')}
    ${text(px + pw / 2, py + 25, 'Meeting notes', { size: 13, weight: 600, anchor: 'middle' })}
    ${icon('x', px + pw - 30, py + 11, 18, 'cm')}
    ${text(px + 32, py + 92, 'Meeting notes', { size: 24, weight: 700 })}
    ${lines(px + 32, py + 116, [320, 300, 220], { gap: 16, h: 7 })}
    ${text(px + 32, py + 190, 'Next steps', { size: 16, weight: 650 })}
    ${[0, 1, 2].map((i) => `<circle cx="${px + 38}" cy="${py + 214 + i * 22}" r="3" class="tm"/>${lines(px + 50, py + 211 + i * 22, [[210, 250, 170][i]], { h: 7 })}`).join('')}
    ${lines(px + 32, py + 300, [330, 290, 310, 180], { gap: 16, h: 7 })}
    <path d="M${px + pw - 8} ${py + ph - 20}L${px + pw - 20} ${py + ph - 8}M${px + pw - 8} ${py + ph - 13}L${px + pw - 13} ${py + ph - 8}" class="line-strong" stroke-width="1.5" stroke-linecap="round"/>
    ${box(W - 62, 150, 44, 172, { r: 12, shadow: true })}
    ${icon('plus', W - 50, 162, 20, 'cm')}${icon('minus', W - 50, 198, 20, 'cm')}
    <line x1="${W - 54}" y1="232" x2="${W - 26}" y2="232" class="line"/>
    <rect x="${W - 57}" y="240" width="34" height="34" rx="8" class="asoft"/>
    ${icon('panel', W - 50, 247, 20, 'ca')}${icon('help', W - 50, 286, 20, 'cm')}
  `);
};

scenes.notetypes = () => {
  const a = { x: 70, y: 70, w: 250 }, b = { x: 450, y: 150, w: 230 };
  const props = (x, y, rows) => rows.map(([k, v], i) =>
    `${text(x, y + i * 22, k, { size: 12, cls: 'tm' })}${text(x + 76, y + i * 22, v, { size: 12, weight: 500 })}`).join('');
  const sx = 720, sy = 16, sw = W - sx - 16, sh = H - 32;
  const rel = [['Led by', 'Ana Ruiz'], ['Part of', 'Q4 roadmap'], ['Depends on', 'Sync engine']];
  return svg('Typed notes as cards, with a relation on the edge between them', `
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
  `);
};

for (const [name, make] of Object.entries(scenes)) {
  writeFileSync(join(OUT, `${name}.svg`), make());
}
console.log(`Wrote ${Object.keys(scenes).length} mockups to ${OUT}`);
