/**
 * The colours a diagram node can take: the canvas's own six, in the order of its colour picker, and any colour of the
 * user's own. A colour is saved as a class name on the node (`ffc-c-red`, `ffc-hex-12ab34`), which the plugin's styles
 * draw, so the source holds it in a form that does nothing, harmlessly, where this plugin isn't running.
 */
export const NODE_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'purple'] as const;
export type PresetColor = typeof NODE_COLORS[number];

/** A colour of the user's own, as `#rrggbb`. */
export type NodeColor = PresetColor | `#${string}`;

export const COLOR_PREFIX = 'ffc-c-';
export const HEX_PREFIX = 'ffc-hex-';
export const HEX_RE = /^#[0-9a-f]{6}$/i;

export const isColorToken = (token: string): boolean => token.startsWith(COLOR_PREFIX) || token.startsWith(HEX_PREFIX);

/** The class a colour is saved as, or empty for none or a colour that isn't one. */
export function colorToken(color: NodeColor | null): string {
  if (color === null) return '';
  if (color.startsWith('#')) return HEX_RE.test(color) ? `${HEX_PREFIX}${color.slice(1).toLowerCase()}` : '';
  return `${COLOR_PREFIX}${color}`;
}

/** The colour a class stands for, or null. */
export function colorFromToken(token: string): NodeColor | null {
  if (token.startsWith(HEX_PREFIX)) {
    const hex = `#${token.slice(HEX_PREFIX.length)}`;
    return HEX_RE.test(hex) ? (hex.toLowerCase() as NodeColor) : null;
  }
  const name = token.startsWith(COLOR_PREFIX) ? token.slice(COLOR_PREFIX.length) : '';
  return NODE_COLORS.find((c) => c === name) ?? null;
}
