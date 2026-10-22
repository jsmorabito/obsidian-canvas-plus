import { App, Scope } from 'obsidian';
import { CanvasViewLike, isElement } from './adapter.ts';
import { ActionId, ToolId, actionForKey, toolForKey } from './tools.ts';

export interface ShortcutTarget {
  setTool(tool: ToolId): void;
  /** Returns false when the action isn't available, so the key goes on to whatever else wants it. */
  runAction(action: ActionId): boolean;
  /** Abandon a draw and go back to Select. Returns whether it did anything. */
  escape(): boolean;
}

/** Elements where typing must never trigger a tool shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  // Not `instanceof HTMLElement`: that is false for an element in a popout window.
  if (!isElement(target)) return false;
  return (target as HTMLElement).isContentEditable || target.closest('input, textarea, select, [contenteditable="true"], .cm-editor') !== null;
}

/**
 * The tool shortcuts, in the canvas view's own key scope. Obsidian only consults a view's scope while that view
 * is the active one, in whichever window it is in, and a presentation swaps in a scope of its own, which turns
 * them off. Keys they don't use go on to the scope that was there before (core's canvas keys).
 * Returns a function that puts that scope back.
 */
export function registerToolShortcuts(app: App, view: CanvasViewLike, target: ShortcutTarget): () => void {
  const previous = view.scope;
  const scope = new Scope(previous ?? app.scope);
  // A handler for every key: returning undefined passes the key on to the scope before, false keeps it.
  scope.register(null, null, (e) => handle(e, target));
  view.scope = scope;
  return () => {
    // A presentation in progress has its own scope in; it puts this one back when it ends, before this runs.
    if (view.scope === scope) view.scope = previous;
  };
}

function handle(e: KeyboardEvent, target: ShortcutTarget): false | undefined {
  // A field being typed in, like a search box or a name being edited, keeps every key, Escape included.
  if (e.isComposing || isTypingTarget(e.target)) return undefined;
  if (e.key === 'Escape') return target.escape() ? false : undefined;
  // Cmd or Ctrl+K opens the actions panel.
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
    return target.runAction('actions') ? false : undefined;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return undefined;
  const key = e.key.toLowerCase();
  const action = e.shiftKey ? undefined : actionForKey(key);
  if (action && target.runAction(action.id)) return false;
  const tool = toolForKey(key, e.shiftKey);
  if (!tool) return undefined;
  target.setTool(tool.id);
  return false;
}
