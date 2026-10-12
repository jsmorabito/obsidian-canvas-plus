/** Widgets: registered views that don't show a file. Reads Obsidian's internal view registry. */
import { App, FuzzyMatch, FuzzySuggestModal, View, WorkspaceLeaf, renderResults, setIcon } from 'obsidian';

interface ViewRegistryInternals {
  viewByType: Record<string, (leaf: WorkspaceLeaf) => View>;
  typeByExtension: Record<string, string>;
}

interface ComponentInternals {
  _events?: Array<() => void>;
}

type LeafCtor = new (app: App) => WorkspaceLeaf;

const NOT_WIDGETS = new Set(['empty', 'webviewer', 'release-notes']);

export interface Widget {
  type: string;
  name: string;
  icon: string;
}

const seen = new Map<string, Widget | null>();

/**
 * Names and icons only come from a view instance, so each type is constructed once (unopened) in a
 * throwaway leaf, since some views modify their leaf, and cached.
 */
export function listWidgets(app: App): Widget[] {
  const registry = (app as unknown as { viewRegistry?: ViewRegistryInternals }).viewRegistry;
  if (!registry) return [];
  const fileTypes = new Set(Object.values(registry.typeByExtension));
  const types = Object.keys(registry.viewByType).filter((t) => !NOT_WIDGETS.has(t) && !fileTypes.has(t));
  const unseen = types.filter((t) => !seen.has(t));
  if (unseen.length > 0) {
    const scratch = new (WorkspaceLeaf as unknown as LeafCtor)(app);
    try {
      for (const type of unseen) seen.set(type, describe(registry.viewByType[type], scratch, type));
    } finally {
      scratch.detach();
    }
  }
  return types
    .map((t) => seen.get(t))
    .filter((w): w is Widget => !!w)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function describe(create: (leaf: WorkspaceLeaf) => View, leaf: WorkspaceLeaf, type: string): Widget | null {
  try {
    const view = create(leaf);
    const name = view.getDisplayText();
    const icon = view.getIcon();
    for (const off of (view as unknown as ComponentInternals)._events?.splice(0) ?? []) off();
    return name ? { type, name, icon } : null;
  } catch {
    return null;
  }
}

export class WidgetPicker extends FuzzySuggestModal<Widget> {
  private widgets: Widget[];
  /** Duplicate names, shown with their view type. */
  private shared: Set<string>;

  constructor(app: App, private leaf: WorkspaceLeaf) {
    super(app);
    this.widgets = listWidgets(app);
    const seen = new Set<string>();
    this.shared = new Set(this.widgets.filter((w) => seen.has(w.name) || !seen.add(w.name)).map((w) => w.name));
    this.setPlaceholder('Find a widget...');
    this.emptyStateText = 'No widgets found.';
    this.setInstructions([
      { command: '↑↓', purpose: 'to navigate' },
      { command: '↵', purpose: 'to open' },
      { command: 'esc', purpose: 'to dismiss' },
    ]);
  }

  getItems(): Widget[] {
    return this.widgets;
  }

  getItemText(widget: Widget): string {
    return widget.name;
  }

  renderSuggestion(match: FuzzyMatch<Widget>, el: HTMLElement): void {
    const widget = match.item;
    el.addClass('mod-complex');
    setIcon(el.createDiv({ cls: 'suggestion-icon' }).createSpan({ cls: 'suggestion-flair' }), widget.icon);
    const content = el.createDiv({ cls: 'suggestion-content' });
    renderResults(content.createDiv({ cls: 'suggestion-title' }), widget.name, match.match);
    if (this.shared.has(widget.name)) content.createDiv({ cls: 'suggestion-note', text: widget.type });
  }

  onChooseItem(widget: Widget): void {
    void this.leaf.setViewState({ type: widget.type, active: true });
  }
}
