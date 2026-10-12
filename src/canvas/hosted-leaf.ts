/**
 * A workspace leaf hosted outside Obsidian's tab groups. Relies on workspace internals: patch here if an
 * update breaks tab panels. The leaf's split claims the host's root, so the workspace treats it as attached
 * (it can be active, so files open in it) without saving it in the layout.
 */
import { App, WorkspaceLeaf, WorkspaceSplit } from 'obsidian';

interface SplitInternals {
  containerEl: HTMLElement;
  insertChild: (index: number, child: WorkspaceLeaf) => void;
  removeChild: (child: WorkspaceLeaf) => void;
  getRoot: () => unknown;
  getContainer: () => unknown;
}

interface LeafInternals {
  containerEl: HTMLElement;
  getRoot: () => unknown;
  getContainer: () => unknown;
}

type GetLeaf = (newLeaf?: unknown, direction?: unknown) => WorkspaceLeaf | null;

interface WorkspaceInternals {
  activeLeaf: WorkspaceLeaf | null;
  isAttached?: (leaf: WorkspaceLeaf) => boolean;
  pushUndoHistory?: (...args: unknown[]) => void;
  getLeaf: GetLeaf;
}

type SplitCtor = new (workspace: unknown, direction: 'vertical' | 'horizontal') => SplitInternals;
type LeafCtor = new (app: App) => WorkspaceLeaf;

export interface HostedLeaf {
  leaf: WorkspaceLeaf;
  el: HTMLElement;
  /** Its child is replaced when the leaf changes view. */
  leafEl: HTMLElement;
  destroy: () => void;
}

/** `onGone` runs when the leaf closes itself or is moved into the workspace. */
export function createHostedLeaf(app: App, host: WorkspaceLeaf, onGone: () => void): HostedLeaf {
  const split = new (WorkspaceSplit as unknown as SplitCtor)(app.workspace, 'vertical');
  const hostInternals = host as unknown as LeafInternals;
  split.getRoot = () => hostInternals.getRoot();
  split.getContainer = () => hostInternals.getContainer();

  const leaf = new (WorkspaceLeaf as unknown as LeafCtor)(app);
  // A leaf finds its root by walking up its parents rather than asking them, so it needs telling too.
  const leafInternals = leaf as unknown as LeafInternals;
  leafInternals.getRoot = split.getRoot;
  leafInternals.getContainer = split.getContainer;
  const release = (): void => {
    Reflect.deleteProperty(leafInternals, 'getRoot');
    Reflect.deleteProperty(leafInternals, 'getContainer');
  };

  let destroying = false;
  const removeChild = split.removeChild.bind(split);
  split.removeChild = (child) => {
    removeChild(child);
    if (destroying) return;
    // A move is a remove then an insert: wait to see which this is.
    window.setTimeout(() => {
      if (destroying) return;
      if (leaf.parent) release();
      onGone();
    }, 0);
  };

  split.insertChild(0, leaf);
  split.containerEl.addClass('ffc-tab-panel-split');
  // Otherwise the host leaf sees focusin bubble up and makes itself active again.
  split.containerEl.addEventListener('focusin', (e) => e.stopPropagation());
  keepNewTabsHere(app, leaf, split.containerEl);

  return {
    leaf,
    el: split.containerEl,
    leafEl: leafInternals.containerEl,
    destroy: () => {
      destroying = true;
      // A moved leaf is a normal tab now; a closed one is already detached.
      const moved = !!leaf.parent && (leaf.parent as unknown) !== split;
      if (!moved) {
        handBackFocus(app, leaf, host);
        if (leaf.parent) detachQuietly(app, leaf);
      }
      split.containerEl.remove();
    },
  };
}

/** New tab screen actions that force a new tab (like Open web viewer) open in this leaf instead. */
function keepNewTabsHere(app: App, leaf: WorkspaceLeaf, el: HTMLElement): void {
  const workspace = app.workspace as unknown as WorkspaceInternals;
  let restore: (() => void) | null = null;
  const end = (): void => {
    restore?.();
    restore = null;
  };
  const begin = (e: Event): void => {
    const target = e.target as Element | null;
    if (!target?.closest?.('.empty-state-action') || leaf.view.getViewType() !== 'empty') return;
    end();
    const had = Object.prototype.hasOwnProperty.call(workspace, 'getLeaf');
    const original = workspace.getLeaf;
    workspace.getLeaf = function (this: unknown, newLeaf?: unknown, direction?: unknown) {
      const intoNew = newLeaf === true || newLeaf === 'tab';
      if (intoNew && leaf.view.getViewType() === 'empty') return leaf;
      return original.call(this, newLeaf, direction);
    };
    restore = () => {
      if (had) workspace.getLeaf = original;
      else Reflect.deleteProperty(workspace, 'getLeaf');
    };
    // Fallback in case the event never bubbles back up.
    window.setTimeout(end, 0);
  };
  el.addEventListener('click', begin, true);
  el.addEventListener('click', end);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') begin(e); }, true);
  el.addEventListener('keydown', end);
}

/** Detach without adding to "Reopen closed tab". */
function detachQuietly(app: App, leaf: WorkspaceLeaf): void {
  const workspace = app.workspace as unknown as WorkspaceInternals;
  const had = Object.prototype.hasOwnProperty.call(workspace, 'pushUndoHistory');
  const original = workspace.pushUndoHistory;
  workspace.pushUndoHistory = () => { /* skipped for this leaf */ };
  try {
    leaf.detach();
  } finally {
    if (had) workspace.pushUndoHistory = original;
    else Reflect.deleteProperty(workspace, 'pushUndoHistory');
  }
}

/** Keep the workspace from pointing at a closed leaf. */
function handBackFocus(app: App, leaf: WorkspaceLeaf, host: WorkspaceLeaf): void {
  const workspace = app.workspace as unknown as WorkspaceInternals;
  if (workspace.activeLeaf !== leaf) return;
  const next = workspace.isAttached?.(host) ?? true ? host : app.workspace.getMostRecentLeaf();
  if (next) app.workspace.setActiveLeaf(next, { focus: true });
}
