import { WIKILINK_ICON } from './icons.ts';

/** A way to mark up part of a node's text. Pele draws each of these in a label (a wikilink is drawn by this plugin, as the text without its brackets); it has no strikethrough or highlight. */
export interface TextFormat {
  id: string;
  label: string;
  icon: string;
  open: string;
  close: string;
  /** With Cmd or Ctrl, in the text field. */
  key?: string;
}

export const TEXT_FORMATS: readonly TextFormat[] = [
  { id: 'bold', label: 'Bold', icon: 'bold', open: '**', close: '**', key: 'b' },
  { id: 'italic', label: 'Italic', icon: 'italic', open: '*', close: '*', key: 'i' },
  { id: 'underline', label: 'Underline', icon: 'underline', open: '<u>', close: '</u>', key: 'u' },
  { id: 'wikilink', label: 'Wikilink', icon: WIKILINK_ICON, open: '[[', close: ']]', key: 'k' },
  { id: 'code', label: 'Inline code', icon: 'code', open: '<code>', close: '</code>', key: 'e' },
];

export interface Edit {
  value: string;
  from: number;
  to: number;
}

/**
 * Turn a format on or off for the selection `from`–`to` of `value`: wrap it, or take the marks off when the
 * selection already has them, inside it or just round it. The selection stays on the same text.
 */
export function toggleFormat(value: string, from: number, to: number, { open, close }: Pick<TextFormat, 'open' | 'close'>): Edit {
  const selected = value.slice(from, to);
  // A lone `*` is italic; `**` is bold, and its asterisks aren't italic's.
  const lone = open === '*';
  const inside = selected.length >= open.length + close.length && selected.startsWith(open) && selected.endsWith(close)
    && !(lone && (selected.startsWith('**') || selected.endsWith('**')));
  if (inside) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return { value: value.slice(0, from) + inner + value.slice(to), from, to: from + inner.length };
  }
  const around = from >= open.length && value.slice(from - open.length, from) === open && value.slice(to, to + close.length) === close
    && !(lone && (value[from - 2] === '*' || value[to + 1] === '*'));
  if (around) {
    return { value: value.slice(0, from - open.length) + selected + value.slice(to + close.length), from: from - open.length, to: to - open.length };
  }
  return { value: value.slice(0, from) + open + selected + close + value.slice(to), from: from + open.length, to: to + open.length };
}
