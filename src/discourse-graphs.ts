// ─── Bridge to the Discourse Graphs plugin ───────────────────────────────────
//
// Discourse Graphs exposes no API, so this reads what it keeps in the open: its
// plugin instance (node types and folders) and the file format of a node (a
// note named from the type's format, with `nodeTypeId` in its frontmatter).
// It is looked up on every use, so it doesn't matter which plugin loads first.
// Update this file with Discourse Graphs' `createNode.ts` if that format changes.

import { App, Notice, TFile, getFrontMatterInfo } from 'obsidian';

export const DG_PLUGIN_ID = 'discourse-graphs';
/** The icon id Discourse Graphs registers for its own logo, once it is enabled. */
export const DG_LOGO_ICON = 'discourse-graph-logo';
/** The view type of its "Discourse context" panel, which lists a node's relations. */
export const DG_CONTEXT_VIEW = 'discourse-context-view';

export interface DgNodeType {
  id: string;
  name: string;
  /** The note's name, with `{content}` standing for the title, such as `CLM - {content}`. */
  format: string;
  color?: string;
  folderPath?: string;
  /** The name of a note in the templates folder. */
  template?: string;
}

interface DgPlugin {
  settings?: { nodeTypes?: DgNodeType[]; nodesFolderPath?: string };
}

/** The characters Discourse Graphs refuses in a node's name. */
const INVALID_NAME = /[#^[\]|]/;
const PLACEHOLDER = /\{[a-zA-Z]+\}/;

function findPlugin(app: App): DgPlugin | null {
  const registry = (app as App & { plugins?: { getPlugin?: (id: string) => unknown } }).plugins;
  const plugin = registry?.getPlugin?.(DG_PLUGIN_ID) as DgPlugin | null | undefined;
  return plugin?.settings && Array.isArray(plugin.settings.nodeTypes) ? plugin : null;
}

export function hasDiscourseGraphs(app: App): boolean {
  return findPlugin(app) !== null;
}

export function dgNodeTypes(app: App): readonly DgNodeType[] {
  return findPlugin(app)?.settings?.nodeTypes ?? [];
}

/** The type of a note that is a discourse node, else undefined. */
export function dgTypeOfFile(app: App, file: TFile): DgNodeType | undefined {
  const id: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.nodeTypeId;
  return typeof id === 'string' ? dgNodeTypes(app).find((t) => t.id === id) : undefined;
}

/** The note name for `title` as a node of `type`, or an error message. */
export function dgNodeName(type: DgNodeType, title: string): { name: string } | { error: string } {
  const text = title.replace(/\s*\n\s*/g, ' ').trim();
  if (!text) return { error: 'A node needs a title.' };
  if (!PLACEHOLDER.test(type.format)) return { error: `${type.name}'s format has no {content} to put the title in.` };
  const name = type.format.replace(PLACEHOLDER, () => text);
  const bad = INVALID_NAME.exec(name);
  if (bad) return { error: `A node's name can't contain ${bad[0]}.` };
  return { name };
}

/** The templates folder of core Templates or Templater, where a type's template lives. */
function templatesFolder(app: App): string | null {
  const a = app as unknown as {
    internalPlugins?: { getPluginById?(id: string): { enabled?: boolean; instance?: { options?: { folder?: string } } } | undefined };
    plugins?: { plugins?: Record<string, { settings?: { templates_folder?: string } } | undefined> };
  };
  const core = a.internalPlugins?.getPluginById?.('templates');
  const folder = (core?.enabled ? core.instance?.options?.folder : '') || a.plugins?.plugins?.['templater-obsidian']?.settings?.templates_folder;
  return folder ? folder.replace(/^\/+|\/+$/g, '') : null;
}

/** Merge a type's template into a new node: its frontmatter (keeping `nodeTypeId`) and its body. */
/** Returns false when the template can't be found. */
async function applyTemplate(app: App, file: TFile, name: string): Promise<boolean> {
  const folder = templatesFolder(app);
  const template = folder ? app.vault.getAbstractFileByPath(`${folder}/${name}.md`) : null;
  if (!(template instanceof TFile)) return false;
  const content = await app.vault.read(template);
  const info = getFrontMatterInfo(content);
  const fm = app.metadataCache.getFileCache(template)?.frontmatter ?? {};
  await app.fileManager.processFrontMatter(file, (target: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(fm)) {
      if (key !== 'position' && !(key in target)) target[key] = value;
    }
  });
  const body = info.exists ? content.slice(info.contentStart) : content;
  if (body.trim()) await app.vault.append(file, body);
  return true;
}

export interface DgResult {
  file: TFile;
  /** False when a note of that name already existed and was used as it is. */
  created: boolean;
}

/**
 * Make a discourse node of `type` titled `title`, the way Discourse Graphs does: in the type's folder (or the
 * default nodes folder), with the type's template. A note already by that name is returned untouched.
 * `description` is added under the template.
 */
export async function createDgNode(app: App, type: DgNodeType, title: string, description = ''): Promise<DgResult> {
  const named = dgNodeName(type, title);
  if ('error' in named) throw new Error(named.error);
  const existing = app.metadataCache.getFirstLinkpathDest(named.name, '');
  if (existing) {
    // Only a node of this type can stand in for the one asked for.
    if (existing.extension !== 'md' || dgTypeOfFile(app, existing)?.id !== type.id) {
      throw new Error(`${named.name} already exists and is not a ${type.name} node.`);
    }
    return { file: existing, created: false };
  }
  const settings = findPlugin(app)?.settings;
  const folder = (type.folderPath?.trim() || settings?.nodesFolderPath?.trim() || '').replace(/^\/+|\/+$/g, '');
  if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
  const file = await app.vault.create(folder ? `${folder}/${named.name}.md` : `${named.name}.md`, '');
  await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => { fm.nodeTypeId = type.id; });
  if (type.template?.trim() && !(await applyTemplate(app, file, type.template.trim()))) {
    new Notice(`Created ${named.name} without its template: ${type.template.trim()} wasn't found.`);
  }
  if (description.trim()) await app.vault.append(file, `\n${description.trim()}\n`);
  return { file, created: true };
}
