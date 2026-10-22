/** Extra field on a `text` node marking free text, which has no card chrome. Stored in canvas files, so the name must not change. */
export const FIELD_KIND = 'ffcKind';
export const KIND_TEXT = 'text';
/** A labelled anchor: a text node holding just its label, listed in the layers panel to jump to. */
export const KIND_ANCHOR = 'anchor';

/** Default node sizes, in canvas units. */
export const SIZE_CARD  = { width: 260, height: 120 };
export const SIZE_TEXT  = { width: 240, height: 40 };
export const SIZE_GROUP = { width: 480, height: 320 };
export const SIZE_ANCHOR = { width: 40, height: 40 };
/**
 * Extra field on an anchor drawn as a frame: the node's own box is what a presentation shows at that stop.
 * Stored in canvas files, so the name must not change.
 */
export const FIELD_FRAME = 'ffcFrame';
/**
 * Extra field on an anchor: its place in the presentation order (1, 2, 3…), set by reordering in the layers
 * panel. Anchors without one follow in reading order. Stored in canvas files, so the name must not change.
 */
export const FIELD_STOP = 'ffcStop';

/** Minimums when drag-creating a node. */
export const MIN_DRAW_WIDTH       = 80;
export const MIN_DRAW_HEIGHT      = 40;
export const MIN_DRAW_HEIGHT_TEXT = 24;

/** Screen-pixel travel under which a press counts as a click, not a drag. */
export const CLICK_SLOP_PX = 5;

/** Note card (a file node for a typed note). */
export const SIZE_NOTE_CARD = { width: 260, height: 100 };

/** Gap kept between nodes when auto-placing a new note card. */
export const PLACE_GAP = 24;

/** Extra field on a `text` node holding one freehand stroke. Stored in canvas files, so the name must not change. */
export const FIELD_INK = 'ffcInk';

/** Canvas preset colours as hex, for SVG that has to carry its own colour (matches Obsidian's palette). */
export const PRESET_HEX: Record<string, string> = {
  '1': '#e93147', '2': '#ec7500', '3': '#e0ac00', '4': '#08b94e', '5': '#00bfbc', '6': '#7852ee',
};

/** Ink with no colour. In the canvas it follows the theme's text colour instead. */
export const INK_FALLBACK_HEX = '#1a1a1a';

/** Screen pixels around the pointer that count as touching a stroke when erasing. */
export const ERASER_RADIUS_PX = 8;

/** Extension field on a file node in the styled link view: the size to go back to when it leaves that view. */
export const FIELD_CARD_SIZE = 'ffcCardSize';

/** Extension field on a `link` node: a readable name shown in the layers panel instead of the URL. */
export const FIELD_LINK_NAME = 'ffcLinkName';

/** Field on the canvas file itself: what's held in its tray, each with its nodes' data. Stored in canvas files, so the name must not change. */
export const FIELD_TRAY = 'ffcTray';

/** Field on the canvas file itself: the comment pins and their threads. Stored in canvas files, so the name must not change. */
export const FIELD_COMMENTS = 'ffcComments';

/**
 * Extra field on a `text` node showing a Linear issue: `{ id, identifier, title, url }`. What the card shows beyond
 * that is fetched from Linear. Stored in canvas files, so the name must not change.
 */
export const FIELD_LINEAR = 'ffcLinear';

/**
 * Extra field on a `text` node showing a Task App issue, the same shape as `ffcLinear`. Stored in canvas files, so the
 * name must not change.
 */
export const FIELD_TASKAPP = 'ffcTaskApp';

/** Linear issue card, the default size of a node showing one. */
export const SIZE_ISSUE_CARD = { width: 280, height: 110 };

/** Extension field on a Linear issue: the size of its full view, kept while it is shown as a card or link. */
export const FIELD_EMBED_SIZE = 'ffcEmbedSize';

/** The first size of an issue's full view, big enough for its properties and the start of its description. */
export const SIZE_ISSUE_EMBED = { width: 360, height: 360 };
