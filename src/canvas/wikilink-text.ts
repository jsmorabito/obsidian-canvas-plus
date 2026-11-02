/** A wikilink as it is drawn: `⟦Note⟧` in a plain node, or `[[Note]]` in a quoted label. */
const WIKILINK = /\[\[([^\][|]+)(?:\|([^\][]+))?\]\]|⟦([^⟧|]+)(?:\|([^⟧]+))?⟧/g;

/** A run of a drawn node's text, and whether it starts a new line (which is a space in the node's words). */
export interface TextPart {
  text: string;
  lineStart: boolean;
}

/**
 * The text of a drawn node's parts with each wikilink shown as its name (or alias), and the first link's target.
 * Pele draws text that wraps as a line each, so a link can begin in one part and end in a later one: they are read as
 * the one text they make, and the link's brackets are taken out of whichever parts hold them.
 */
export function stripWikilinks(parts: readonly TextPart[]): { texts: string[]; target: string | null } {
  const starts: number[] = [];
  let joined = '';
  parts.forEach((part, n) => {
    if (n > 0 && part.lineStart) joined += ' ';
    starts.push(joined.length);
    joined += part.text;
  });

  let target: string | null = null;
  const cuts: Array<[number, number]> = [];
  for (const found of joined.matchAll(WIKILINK)) {
    const [whole, a, b, c, d] = found;
    const name = (a ?? c ?? '').trim();
    target ??= name;
    // What stays is the alias, or else the name; the rest is the link's markup.
    const shown = (b ?? d ?? name).trim();
    const begin = found.index ?? 0;
    const at = begin + whole.lastIndexOf(shown);
    cuts.push([begin, at], [at + shown.length, begin + whole.length]);
  }

  const texts = parts.map((part) => part.text);
  // From the last cut to the first, so a cut's place is still what it was when the ones after it were made.
  for (const [from, to] of cuts.reverse()) {
    texts.forEach((text, n) => {
      const a = Math.max(from, starts[n]) - starts[n];
      const b = Math.min(to, starts[n] + text.length) - starts[n];
      if (a < b) texts[n] = text.slice(0, a) + text.slice(b);
    });
  }
  return { texts, target };
}
