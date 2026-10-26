import { TEXT_FORMATS, TextFormat, toggleFormat } from './mindmap-format.ts';

const EDITING_CLASS = 'ffc-mm-editing';

/**
 * Where the field goes, on screen: the middle of the text it covers, or, for an edge with no label to cover, the
 * middle of the line (the middle of its box could be off a curved line).
 */
function anchorOf(el: Element, text: Element | null): { x: number; y: number } {
  if (text) {
    const rect = text.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  const line = el.querySelector<SVGGeometryElement>('path:not(.pele-marker):not(.ffc-edge-hit)');
  const ctm = line?.getScreenCTM();
  if (line && ctm && typeof line.getTotalLength === 'function') {
    const p = line.getPointAtLength(line.getTotalLength() / 2);
    return { x: ctm.a * p.x + ctm.c * p.y + ctm.e, y: ctm.b * p.x + ctm.d * p.y + ctm.f };
  }
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export interface InPlaceField {
  /** Leave the field, which saves it. */
  close(): void;
}

/**
 * A text field over a diagram's own text, in the same type, so the text is edited where it is. `el` is the node (or
 * edge label) it covers; its text steps aside while the field is there. Enter saves, Tab saves and says so (the
 * caller may add something next), Escape drops it, and so does nothing else: leaving the field saves it.
 */
export function openInPlaceField(
  host: HTMLElement, el: Element, initial: string, done: (text: string, commit: boolean, tab: boolean) => void,
  formats: readonly TextFormat[] = TEXT_FORMATS,
): InPlaceField {
  const text = el.querySelector<SVGElement>('.pele-label, text');
  const anchor = anchorOf(el, text);
  const hostRect = host.getBoundingClientRect();
  // The canvas zooms with a transform, so measured sizes are screen pixels and the field needs canvas ones.
  const scale = host.offsetWidth > 0 ? hostRect.width / host.offsetWidth : 1;
  const style = text ? window.getComputedStyle(text) : null;
  // The text's size is in drawing units; the drawing is itself scaled to the page.
  const drawn = (el as SVGGraphicsElement).ownerSVGElement?.getScreenCTM()?.a ?? 1;
  const input = host.createEl('textarea', { cls: 'ffc-mm-input', attr: { rows: '1', spellcheck: 'false', 'aria-roledescription': 'Node text' } });
  input.value = initial;
  input.setCssProps({
    '--ffc-mm-left': `${(anchor.x - hostRect.left) / scale}px`,
    '--ffc-mm-top': `${(anchor.y - hostRect.top) / scale}px`,
    '--ffc-mm-font-size': `${(parseFloat(style?.fontSize ?? '16') * drawn) / scale}px`,
    '--ffc-mm-font-family': style?.fontFamily ?? 'inherit',
    '--ffc-mm-font-weight': style?.fontWeight ?? 'normal',
    '--ffc-mm-text-color': style && style.fill !== 'none' ? style.fill : 'inherit',
  });
  el.addClass(EDITING_CLASS);

  let finished = false;
  const finish = (commit: boolean, tab = false): void => {
    if (finished) return;
    finished = true;
    const value = input.value;
    input.remove();
    el.removeClass(EDITING_CLASS);
    done(value, commit, tab);
  };
  // Bold, italic and the other formats, as keys in the field, over the selection.
  const format = (f: TextFormat): void => {
    const edit = toggleFormat(input.value, input.selectionStart, input.selectionEnd, f);
    input.value = edit.value;
    input.setSelectionRange(edit.from, edit.to);
    input.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.isComposing) return;
    const chosen = (e.metaKey || e.ctrlKey) && !e.altKey ? formats.find((f) => f.key === e.key.toLowerCase()) : undefined;
    if (chosen) {
      e.preventDefault();
      format(chosen);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      finish(true, true);
    } else if (e.key === 'Escape') finish(false);
  });
  // The canvas would start a drag or a marquee from a press in the field.
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
  input.addEventListener('blur', () => finish(true));
  input.focus();
  input.select();
  return {
    close: () => {
      // Leaving the field saves it and takes it out. Taking it out first would run that from inside the removal.
      if (input.isConnected) input.blur();
      input.remove();
    },
  };
}
