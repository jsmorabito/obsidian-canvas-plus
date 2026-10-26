import { Menu, MenuItem, Notice, SuggestModal, TFile, prepareFuzzySearch } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import type { RelationType } from '../note-types.ts';
import { templateFolders } from './template-folders.ts';

/** Pick the note a relation points at. */
class TargetPicker extends SuggestModal<TFile> {
  constructor(plugin: CanvasPlusPlugin, private files: TFile[], relation: string, private pick: (file: TFile) => void) {
    super(plugin.app);
    this.setPlaceholder(`${relation}…`);
  }

  getSuggestions(query: string): TFile[] {
    const q = query.trim();
    if (!q) return [...this.files].sort((a, b) => a.basename.localeCompare(b.basename));
    const match = prepareFuzzySearch(q);
    return this.files
      .map((file) => ({ file, hit: match(file.basename) }))
      .filter((x) => x.hit)
      .sort((a, b) => (b.hit?.score ?? 0) - (a.hit?.score ?? 0))
      .map((x) => x.file);
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.createSpan({ text: file.basename, cls: 'suggestion-title' });
  }

  onChooseSuggestion(file: TFile): void {
    this.pick(file);
  }
}

/** Submenus are not in the public typings. */
function submenuOf(item: MenuItem): Menu {
  return (item as MenuItem & { setSubmenu: () => Menu }).setSubmenu();
}

/**
 * The file menu's "Mark as…" for a note card: relation, then which notes to
 * relate to (any, or one note type's), then the note itself. What to do with
 * the choice is the caller's.
 */
export function openMarkAsMenu(
  plugin: CanvasPlusPlugin, source: TFile, at: { x: number; y: number }, onPick: (target: TFile, rt: RelationType) => void,
): void {
  const api = plugin.types;
  const relations = api.getRelationTypes();
  if (relations.length === 0) return;

  const choose = (rt: RelationType, candidates: TFile[]): void => {
    const templates = templateFolders(plugin.app);
    const files = candidates.filter((f) => f.path !== source.path && !templates.some((t) => f.path.startsWith(`${t}/`)));
    if (files.length === 0) {
      new Notice('No notes available to relate to.');
      return;
    }
    new TargetPicker(plugin, files, api.resolveRelation(rt).forwardName, (target) => onPick(target, rt)).open();
  };

  const menu = new Menu();
  for (const rt of relations) {
    menu.addItem((item) => {
      item.setTitle(rt.name || 'Untitled relation');
      const types = submenuOf(item);
      types.addItem((i) => i.setTitle('Any note…').onClick(() => choose(rt, plugin.app.vault.getMarkdownFiles())));
      const noteTypes = api.getNoteTypes();
      if (noteTypes.length > 0) types.addSeparator();
      for (const nt of noteTypes) {
        types.addItem((i) => i.setTitle(nt.name || 'Untitled note type').onClick(() => choose(rt, api.getNoteTypeFiles(nt))));
      }
    });
  }
  menu.showAtPosition(at);
}
