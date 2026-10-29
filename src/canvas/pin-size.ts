import { FIELD_CARD_SIZE, FIELD_EMBED_SIZE, FIELD_VIEW, SIZE_ISSUE_CARD, SIZE_NOTE_CARD } from './constants.ts';

export interface Size { width: number; height: number }
export type CardView = 'card' | 'embed' | 'link';

/**
 * What putting a note card, issue or plain node back in its card view takes before it is pinned, so the pin
 * previews the card and gives the card's size back: the size to remember, and the fields to change on the node.
 * `box` is its size now; `saved` are the sizes it remembers for its other views.
 */
export function settleToCard(view: CardView, issue: boolean, box: Size | null, saved: { card: Size | null }): { size: Size; patch: Record<string, unknown> } {
  const own = issue ? SIZE_ISSUE_CARD : SIZE_NOTE_CARD;
  if (view === 'card') return { size: box ?? own, patch: {} };
  const patch: Record<string, unknown> = { [FIELD_VIEW]: undefined };
  if (issue) {
    // An issue keeps a size for each view: remember the full issue's before leaving it.
    if (view === 'embed' && box) patch[FIELD_EMBED_SIZE] = { width: box.width, height: box.height };
    return { size: saved.card ?? own, patch };
  }
  // A note's card and embed share a box; the link remembers the card's.
  if (view === 'link') {
    patch[FIELD_CARD_SIZE] = undefined;
    return { size: saved.card ?? own, patch };
  }
  return { size: box ?? own, patch };
}
