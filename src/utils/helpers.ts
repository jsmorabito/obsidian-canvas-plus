import type { App, TFile } from 'obsidian';

/** A frontmatter value as display text: strings as-is, numbers and booleans stringified, anything else as JSON. */
export function stringifyFrontmatterValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return ''; }
}

/** Strip `[[ ]]`, a leading `!`, a trailing `|alias`, and a `#heading` from a link string. */
function stripLinktext(raw: unknown): string {
  let s = stringifyFrontmatterValue(raw).trim();
  const m = s.match(/^!?\[\[(.*?)\]\]$/);
  if (m) s = m[1];
  s = s.split('|')[0];
  s = s.split('#')[0];
  return s.trim();
}

/** Resolve a frontmatter link string to a file in the vault, or null. */
export function resolveLinktext(app: App, raw: unknown, fromPath: string): TFile | null {
  const path = stripLinktext(raw);
  if (!path) return null;
  return app.metadataCache.getFirstLinkpathDest(path, fromPath);
}
