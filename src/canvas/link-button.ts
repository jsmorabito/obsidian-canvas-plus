import type { Editor } from 'obsidian';
import { CanvasLike, CanvasNodeLike, selectedNodes } from './adapter.ts';
import { button } from './issue-menu.ts';

const LINK_CLASS = 'ffc-link-btn';

/** The editor of the card being typed in, if the caret is in one and some of its text is selected. */
function editorWithSelection(canvas: CanvasLike): Editor | undefined {
  const active = canvas.wrapperEl?.doc.activeElement;
  // Runs on every selection change in the window: leave at once for anything outside the canvas.
  if (!active || !canvas.wrapperEl.contains(active)) return undefined;
  for (const node of selectedNodes(canvas) as Array<CanvasNodeLike & { child?: { editor?: Editor } }>) {
    const editor = node.child?.editor;
    if (editor && node.nodeEl?.contains(active) && isLinkable(editor.getSelection())) return editor;
  }
  return undefined;
}

/** One line with something in it: a link's text can't span lines, and spaces alone make no link. */
const isLinkable = (text: string): boolean => text.trim() !== '' && !text.includes('\n');

/** Wrap the selection as `[text]()` and leave the caret between the brackets, ready for a link to be pasted. */
function wrapAsLink(editor: Editor): void {
  const start = editor.posToOffset(editor.getCursor('from'));
  const text = editor.getSelection();
  editor.replaceSelection(`[${text}]()`);
  editor.setCursor(editor.offsetToPos(start + text.length + 3));
}

/**
 * A link button in the selection pop-up menu while text is selected in a card being edited. It is added and
 * removed here, as selecting text does not rebuild the menu.
 */
export function syncLinkButton(canvas: CanvasLike): void {
  const menuEl = canvas.menu?.menuEl;
  if (!menuEl) return;
  const editor = editorWithSelection(canvas);
  if (!editor) {
    menuEl.querySelector(`.${LINK_CLASS}`)?.remove();
    return;
  }
  button(menuEl, LINK_CLASS, 'Link selection', 'link', () => {
    const current = editorWithSelection(canvas);
    if (current) wrapAsLink(current);
  });
  // A press must not take focus from the editor, or the selection is lost before the click.
  const btn = menuEl.querySelector<HTMLElement>(`.${LINK_CLASS}`);
  if (btn && !btn.dataset.ffcKeepFocus) {
    btn.dataset.ffcKeepFocus = '1';
    btn.addEventListener('mousedown', (e) => e.preventDefault());
  }
}
