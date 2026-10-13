import { CLICK_SLOP_PX } from './constants.ts';
import { trackPointer } from './pointer-session.ts';

/** On a row while it is dragged: core's own look for a tree item being dragged. */
const DRAGGED_CLASS = 'is-being-dragged';
/** On a row from the press until it is let go, dragged or not, so the list isn't rebuilt under it. */
const PRESSED_CLASS = 'ffc-reorder-pressed';
/** On touch, a drag starts after holding a row this long; moving sooner scrolls the list, as usual. */
const LONG_PRESS_MS = 350;

/** Whether a row of `listEl` is pressed or being dragged, so the list isn't rebuilt under it. */
export function isReordering(listEl: HTMLElement): boolean {
  return listEl.querySelector(`.${PRESSED_CLASS}`) !== null;
}

/**
 * Drag the rows of a flat list into a new order, as core's lists reorder: the row takes core's dragged look and
 * core's drop indicator marks where it will land. With a mouse or pen a drag starts once the pointer moves; on
 * touch, once the row is held still, so a swipe still scrolls the list. A press that doesn't drag is still a
 * click. `onDrop` gets the row's old index and its new one, and is only called when they differ.
 */
export function makeReorderable(listEl: HTMLElement, rows: HTMLElement[], onDrop: (from: number, to: number) => void): void {
  const indicator = listEl.createDiv({ cls: 'drop-indicator' });
  rows.forEach((row, from) => {
    row.addClass('ffc-reorderable');
    row.addEventListener('pointerdown', (down) => {
      if (down.button !== 0 || row.hasClass('is-being-renamed')) return;
      const doc = row.doc;
      const touch = down.pointerType === 'touch';
      let dragging = false;
      let before = from;
      let holdTimer = 0;
      // Once a touch drag has started, the finger moves the row, not the list.
      const keepFromScrolling = (e: TouchEvent): void => e.preventDefault();
      const begin = (): void => {
        dragging = true;
        row.addClass(DRAGGED_CLASS);
        doc.body.addClass('is-grabbing');
        if (touch) doc.addEventListener('touchmove', keepFromScrolling, { passive: false });
        placeIndicator(listEl, indicator, rows, before);
      };
      const finish = (): void => {
        stopTracking();
        row.win.clearTimeout(holdTimer);
        doc.removeEventListener('touchmove', keepFromScrolling);
        row.removeClass(DRAGGED_CLASS, PRESSED_CLASS);
        doc.body.removeClass('is-grabbing');
        indicator.removeClass('is-active');
      };
      const stopTracking = trackPointer(doc, down.pointerId, {
        move: (e) => {
          const moved = Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) >= CLICK_SLOP_PX;
          if (!dragging) {
            // A touch that moves before the hold is a scroll: let the list have it.
            if (touch) { if (moved) finish(); return; }
            if (!moved) return;
            begin();
          }
          before = insertionIndex(rows, e.clientY);
          placeIndicator(listEl, indicator, rows, before);
        },
        up: () => {
          finish();
          if (!dragging) return;
          swallowNextClick(doc);
          // Dropped below itself, the row's own slot closes up: one fewer row comes before it.
          const to = before > from ? before - 1 : before;
          if (to !== from) onDrop(from, to);
        },
        cancel: finish,
      });
      row.addClass(PRESSED_CLASS);
      if (touch) holdTimer = row.win.setTimeout(begin, LONG_PRESS_MS);
    });
  });
}

/** The index of the row the pointer is above the middle of, or the end of the list. */
function insertionIndex(rows: HTMLElement[], clientY: number): number {
  const i = rows.findIndex((row) => {
    const rect = row.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  return i === -1 ? rows.length : i;
}

/** Core's drop indicator, a line across the list, at the top of row `before` (or under the last row). */
function placeIndicator(listEl: HTMLElement, indicator: HTMLElement, rows: HTMLElement[], before: number): void {
  const listTop = listEl.getBoundingClientRect().top - listEl.scrollTop;
  const rect = before < rows.length ? rows[before].getBoundingClientRect() : rows[rows.length - 1].getBoundingClientRect();
  const y = before < rows.length ? rect.top : rect.bottom;
  indicator.setCssStyles({ top: `${y - listTop}px` });
  indicator.addClass('is-active');
}

/**
 * A drag that ends where it started would also click the row, selecting and zooming to it: stop that one click.
 * If no click comes (the drag ended over another row), the next press drops the wait, before its own click.
 */
function swallowNextClick(doc: Document): void {
  const swallow = (e: MouseEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    stopWaiting();
  };
  const stopWaiting = (): void => {
    doc.removeEventListener('click', swallow, true);
    doc.removeEventListener('pointerdown', stopWaiting, true);
  };
  doc.addEventListener('click', swallow, true);
  doc.addEventListener('pointerdown', stopWaiting, true);
}
