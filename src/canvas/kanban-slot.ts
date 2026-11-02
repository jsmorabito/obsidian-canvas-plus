import type { Kanban } from './kanban-edit.ts';

/** A box on the screen. A `DOMRect` is one. */
export interface SlotBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A column as it is on the screen, with the cards that count as being in it. */
export interface SlotColumn {
  /** Its index in `Kanban.columns`. */
  i: number;
  rect: SlotBox;
  /** Where its title ends, which is where an empty column's cards start. */
  headerBottom: number;
  cards: Array<{ i: number; rect: SlotBox }>;
}

/** Where something put on the board at a point would go. */
export interface Slot {
  column: SlotColumn;
  /** The card it goes above, or none for the bottom of the column. */
  before?: number;
  /** The screen height of the line that shows it. */
  edge: number;
}

/** Set on the column something would be dropped in. */
export const DROP_COLUMN_CLASS = 'ffc-kb-drop-column';

/** Half the gap between cards, in the drawing's own units: how far the line that shows a drop is from the card beside it. */
export const HALF_GAP = 4;

/**
 * Where something dropped at (x, y) would go: the column nearest the point sideways, and above the first of its
 * cards whose middle is below the point. `unit` is screen pixels per drawing unit. Null when there are no columns.
 */
export function chooseSlot(columns: readonly SlotColumn[], x: number, y: number, unit: number): Slot | null {
  let column: SlotColumn | null = null;
  let nearest = Infinity;
  for (const candidate of columns) {
    const { left, right } = candidate.rect;
    const dist = Math.max(left - x, 0, x - right);
    if (dist < nearest) {
      nearest = dist;
      column = candidate;
    }
  }
  if (!column) return null;
  const before = column.cards.find((c) => y < (c.rect.top + c.rect.bottom) / 2);
  const last = column.cards[column.cards.length - 1];
  const gap = HALF_GAP * unit;
  const edge = before ? before.rect.top - gap : last ? last.rect.bottom + gap : column.headerBottom + gap;
  return { column, before: before?.i, edge };
}

/**
 * The columns of a drawing, measured. `columns` and `cards` are its `.pele-column` and `.pele-card` elements in
 * the order the source has them; `skip` is a card that isn't counted (the one being dragged).
 */
export function measureColumns(kanban: Kanban, columns: readonly Element[], cards: readonly Element[], skip?: number): SlotColumn[] {
  return kanban.columns.map((column, i) => {
    const rect = columns[i].getBoundingClientRect();
    const label = columns[i].querySelector('.pele-cluster-label')?.getBoundingClientRect();
    return {
      i,
      rect,
      headerBottom: label?.bottom ?? rect.top,
      cards: column.cards.filter((c) => c !== skip).map((c) => ({ i: c, rect: cards[c].getBoundingClientRect() })),
    };
  });
}

/** Screen pixels per drawing unit of an SVG's drawing. */
export function unitOf(el: Element): number {
  const ctm = (el as SVGGraphicsElement).ownerSVGElement?.getScreenCTM();
  return ctm && ctm.a > 0 ? ctm.a : 1;
}

/** Put the line that shows a slot in `host` (which the drawing is in), under the column the slot is in. */
export function placeIndicator(host: HTMLElement, indicator: HTMLElement, slot: Slot, unit: number): void {
  const hostRect = host.getBoundingClientRect();
  // The canvas zooms with a transform, so measured sizes are screen pixels and the line needs canvas ones.
  const scale = host.offsetWidth > 0 ? hostRect.width / host.offsetWidth : 1;
  const inset = 2 * HALF_GAP * unit;
  const { rect } = slot.column;
  indicator.removeClass('is-hidden');
  indicator.setCssProps({
    '--ffc-mm-left': `${(rect.left + inset - hostRect.left) / scale}px`,
    '--ffc-mm-top': `${(slot.edge - hostRect.top) / scale}px`,
    '--ffc-mm-width': `${(rect.right - rect.left - 2 * inset) / scale}px`,
  });
}
