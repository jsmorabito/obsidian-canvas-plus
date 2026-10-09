import { Notice, TFile } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import type { NoteType, RelationSides, RelationType } from '../note-types.ts';
import { CanvasEdgeLike, CanvasNodeLike } from './adapter.ts';
import { noteOfNode } from './note-card.ts';
import type { SideEffect } from './undo-journal.ts';

export interface NoteRef { file: TFile; type: NoteType }

/** A canvas node as a typed note, or null (untyped notes and non-notes don't take relations). */
export function noteRefFor(plugin: CanvasPlusPlugin, node: CanvasNodeLike): NoteRef | null {
  const file = noteOfNode(node);
  const type = file ? plugin.types.getNoteTypeForFile(file) : undefined;
  return file && type ? { file, type } : null;
}

/**
 * The relation an edge shows, derived live from the notes: the edge label must
 * be a relation's name and the source note must hold that relation to the
 * destination. A relation made or removed anywhere restyles the edge.
 */
export function relationOfEdge(plugin: CanvasPlusPlugin, edge: CanvasEdgeLike): RelationType | null {
  const label = edge.label;
  if (!label) return null;
  const from = noteOfNode(edge.from.node);
  const to = noteOfNode(edge.to.node);
  if (!from || !to) return null;
  const held = plugin.types.listRelationsForFile(from)
    .some((r) => r.direction === 'forward' && r.label === label && r.targetFile?.path === to.path);
  if (!held) return null;
  return plugin.types.getRelationTypes().find((rt) => plugin.types.resolveRelation(rt).forwardName === label) ?? null;
}

export interface PairUsage {
  /** Relations already running from notes of the first type to notes of the second, keyed by relation id. */
  forward: Map<string, number>;
  /** The same, from the second type to the first. */
  reverse: Map<string, number>;
}

/**
 * How often each relation is already used between two note types, in both
 * directions, in one pass. Looking up a note's type scans every note type's
 * rules, so each target is resolved once and remembered.
 */
export function usageBetween(plugin: CanvasPlusPlugin, a: NoteType, b: NoteType): PairUsage {
  const byName = new Map(plugin.types.getRelationTypes().map((rt) => [plugin.types.resolveRelation(rt).forwardName, rt.id]));
  const typeIds = new Map<string, string | undefined>();
  const typeId = (file: TFile): string | undefined => {
    if (!typeIds.has(file.path)) typeIds.set(file.path, plugin.types.getNoteTypeForFile(file)?.id);
    return typeIds.get(file.path);
  };
  const scan = (from: NoteType, to: NoteType): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const file of plugin.types.getNoteTypeFiles(from)) {
      for (const ref of plugin.types.listRelationsForFile(file)) {
        if (ref.direction !== 'forward' || !ref.targetFile || typeId(ref.targetFile) !== to.id) continue;
        const id = byName.get(ref.label);
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  };
  const forward = scan(a, b);
  return { forward, reverse: a.id === b.id ? forward : scan(b, a) };
}

/** Add a relation type from the canvas menu: a name and an optional complement (the reverse label). */
export function createRelationType(plugin: CanvasPlusPlugin, name: string, complement: string): Promise<RelationType> {
  return plugin.types.addRelationType(name, complement);
}

/** What a removal took out, so it can be put back. */
export interface RemovedRelation {
  source: TFile;
  target: TFile;
  rt: RelationType;
  sides: RelationSides;
}

/** Remove the relation an edge shows from the notes. Only the sides that actually held it are removed (and reported). */
export async function removeRelationOf(plugin: CanvasPlusPlugin, edge: CanvasEdgeLike): Promise<RemovedRelation | null> {
  const source = noteOfNode(edge.from.node);
  const target = noteOfNode(edge.to.node);
  const rt = relationOfEdge(plugin, edge);
  if (!source || !target || !rt) {
    new Notice('That relation no longer exists.');
    return null;
  }
  const { forwardKey, reverseKey } = plugin.types.resolveRelation(rt);
  const sides: RelationSides = {
    forward: plugin.types.hasRelationLink(source, forwardKey, target),
    reverse: plugin.types.hasRelationLink(target, reverseKey, source),
  };
  await plugin.types.removeRelationSides(source, target, rt, sides);
  new Notice('Relation removed.');
  return { source, target, rt, sides };
}

/**
 * Whether any note still holds a relation of this type (under either of its keys). `cleaned` are notes whose
 * links were removed a moment ago: Obsidian updates its metadata cache after the write, so the cache still
 * shows their old frontmatter and they must not count.
 */
function relationTypeInUse(plugin: CanvasPlusPlugin, rt: RelationType, cleaned: TFile[]): boolean {
  const { forwardKey, reverseKey } = plugin.types.resolveRelation(rt);
  const skip = new Set(cleaned.map((f) => f.path));
  return plugin.app.vault.getMarkdownFiles().some((file) => {
    if (skip.has(file.path)) return false;
    const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    return !!fm && [forwardKey, reverseKey].some((key) => key !== '' && fm[key] !== undefined && fm[key] !== null);
  });
}

/** Undo a type created from the canvas menu. It stays if notes still use it, so no definition is lost. */
async function dropRelationType(plugin: CanvasPlusPlugin, rt: RelationType, cleaned: TFile[]): Promise<void> {
  if (relationTypeInUse(plugin, rt, cleaned)) return;
  await plugin.types.removeRelationType(rt.id);
}

/** The note side of making a relation: undo takes out what was written, and a type created for it. */
export function addedRelationEffect(
  plugin: CanvasPlusPlugin, source: TFile, target: TFile, rt: RelationType, sides: RelationSides, createdType: boolean,
): SideEffect {
  return {
    undo: async () => {
      await plugin.types.removeRelationSides(source, target, rt, sides);
      // Only the notes this undo actually removed a link from are known to be clean already.
      if (createdType) await dropRelationType(plugin, rt, [...(sides.forward ? [source] : []), ...(sides.reverse ? [target] : [])]);
    },
    redo: async () => {
      if (createdType) await plugin.types.restoreRelationType(rt);
      await plugin.types.writeRelationSides(source, target, rt, sides);
    },
    files: [source, target],
    undoNotice: `Removed the relation from ${source.basename} and ${target.basename}.`,
    redoNotice: `Restored the relation on ${source.basename} and ${target.basename}.`,
  };
}

/** The note side of removing a relation: undo puts back what was taken out. */
export function removedRelationEffect(plugin: CanvasPlusPlugin, removed: RemovedRelation): SideEffect {
  const { source, target, rt, sides } = removed;
  return {
    undo: () => plugin.types.writeRelationSides(source, target, rt, sides),
    redo: () => plugin.types.removeRelationSides(source, target, rt, sides),
    files: [source, target],
    undoNotice: `Restored the relation on ${source.basename} and ${target.basename}.`,
    redoNotice: `Removed the relation from ${source.basename} and ${target.basename}.`,
  };
}
