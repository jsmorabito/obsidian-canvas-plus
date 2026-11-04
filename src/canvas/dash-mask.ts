/** The dash and gap the dashed border is aimed at, in px. The gaps are stretched a little so whole dashes fit. */
const DASH = 8;
const GAP = 6;

/**
 * The dashed line for a card of this size and corner radius, as a mask. As in Figma, a dash is centred on each corner,
 * so the corners weigh the same as any other dash, and the dashes and gaps on each side are spread evenly to fit: a
 * dash and gap fixed for the whole outline leave an odd pair wherever the line closes.
 */
export function dashMask(width: number, height: number, radius: number): string {
  // A card too small for its own corners keeps the outline inside it.
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const k = r * (1 - Math.SQRT1_2);
  const quarter = (Math.PI * r) / 2;
  const arc = (x: number, y: number): string => `A${r} ${r} 0 0 1 ${x} ${y}`;
  // One side, from the middle of one corner's curve to the middle of the next. It begins and ends half way through a
  // dash, and the two halves at a corner make one whole dash.
  const side = (d: string, straight: number): string => {
    const length = straight + quarter;
    const count = Math.max(1, Math.round(length / (DASH + GAP)));
    const period = length / count;
    const dash = (period * DASH) / (DASH + GAP);
    return `<path d='${d}' fill='none' stroke='#000' stroke-width='2' stroke-dasharray='${dash.toFixed(3)} ${(period - dash).toFixed(3)}' stroke-dashoffset='${(dash / 2).toFixed(3)}'/>`;
  };
  const w = width - 2 * r;
  const h = height - 2 * r;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>`
    + side(`M${k} ${k}${arc(r, 0)}H${width - r}${arc(width - k, k)}`, w)
    + side(`M${width - k} ${k}${arc(width, r)}V${height - r}${arc(width - k, height - k)}`, h)
    + side(`M${width - k} ${height - k}${arc(width - r, height)}H${r}${arc(k, height - k)}`, w)
    + side(`M${k} ${height - k}${arc(0, height - r)}V${r}${arc(k, k)}`, h)
    + '</svg>';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
