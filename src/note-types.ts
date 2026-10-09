// ─── Bridge to the Note Types plugin ─────────────────────────────────────────
//
// Note cards, relations on edges and key images need Note Types. Its API is
// looked up on every use, so it doesn't matter which plugin loads first, and
// enabling or disabling Note Types takes effect without reloading this one.
// Without it, `NO_NOTE_TYPES` answers instead: no note has a type, so none of
// those features turn on, and the rest of the canvas tools work as usual.
//
// The types below mirror Note Types' `src/api.ts` and `src/types.ts`, keeping
// only the members this plugin reads. Update them together.

import type { App, TFile } from 'obsidian';

export const NOTE_TYPES_PLUGIN_ID = 'filtered-file-commands';
/** The lowest Note Types API version this plugin works with. */
const MIN_API_VERSION = 1;

export interface CanvasField {
  key: string;
  label: string;
}

export interface NoteType {
  id: string;
  name: string;
  styledLinks?: boolean;
  linkColor?: string;
  linkIcon?: string;
  showLinkIcon?: boolean;
  showStatusInLinks?: boolean;
  canvasFields: CanvasField[];
  imageKey?: string;
  /** How the key image sits on a canvas card too short for it: `fill` crops it (the default), `fit` shows it whole. */
  canvasImageFit?: 'fit' | 'fill';
}

export interface RelationType {
  id: string;
  name: string;
  frontmatterKey: string;
  reverseName: string;
  reverseKey: string;
  builtin?: boolean;
}

/** Which notes' frontmatter a relation touches: the source's forward key, the target's reverse key. */
export interface RelationSides {
  forward: boolean;
  reverse: boolean;
}

export interface ResolvedRelation {
  forwardKey: string;
  reverseKey: string;
  forwardName: string;
  reverseName: string;
  symmetric: boolean;
}

export interface RelationRef {
  ownKey: string;
  otherKey: string;
  label: string;
  direction: 'forward' | 'reverse';
  linktext: string;
  targetFile: TFile | null;
}

export interface NoteTypesApi {
  readonly version: number;
  getNoteTypes(): readonly NoteType[];
  getNoteTypeForFile(file: TFile): NoteType | undefined;
  getNoteTypeFiles(type: NoteType): TFile[];
  createNote(type: NoteType, title: string, fieldValues?: Record<string, string>, description?: string): Promise<TFile | null>;
  getRelationTypes(): readonly RelationType[];
  resolveRelation(rt: RelationType): ResolvedRelation;
  addRelationType(name: string, reverseName?: string): Promise<RelationType>;
  restoreRelationType(rt: RelationType): Promise<void>;
  removeRelationType(id: string): Promise<void>;
  listRelationsForFile(file: TFile): RelationRef[];
  hasRelationLink(file: TFile, key: string, target: TFile): boolean;
  addRelation(source: TFile, target: TFile, rt: RelationType): Promise<RelationSides>;
  writeRelationSides(source: TFile, target: TFile, rt: RelationType, sides: RelationSides): Promise<void>;
  removeRelationSides(source: TFile, target: TFile, rt: RelationType, sides: RelationSides): Promise<void>;
}

const unavailable = (): Promise<never> => Promise.reject(new Error('Note Types is not enabled.'));

/** Stands in for Note Types when it isn't installed or enabled: nothing has a type, and nothing can be written. */
export const NO_NOTE_TYPES: NoteTypesApi = {
  version: 0,
  getNoteTypes: () => [],
  getNoteTypeForFile: () => undefined,
  getNoteTypeFiles: () => [],
  createNote: unavailable,
  getRelationTypes: () => [],
  resolveRelation: (rt) => ({
    forwardKey: rt.frontmatterKey, reverseKey: rt.reverseKey || rt.frontmatterKey,
    forwardName: rt.name, reverseName: rt.reverseName || rt.name, symmetric: !rt.reverseKey,
  }),
  addRelationType: unavailable,
  restoreRelationType: unavailable,
  removeRelationType: unavailable,
  listRelationsForFile: () => [],
  hasRelationLink: () => false,
  addRelation: unavailable,
  writeRelationSides: unavailable,
  removeRelationSides: unavailable,
};

/** `app.plugins`, which the public typings leave out. */
interface PluginRegistry {
  getPlugin?: (id: string) => { api?: unknown } | null;
}

/** Note Types' API when it is enabled and new enough, else null. */
export function findNoteTypesApi(app: App): NoteTypesApi | null {
  const registry = (app as App & { plugins?: PluginRegistry }).plugins;
  const api = registry?.getPlugin?.(NOTE_TYPES_PLUGIN_ID)?.api as NoteTypesApi | undefined;
  return api && typeof api.version === 'number' && api.version >= MIN_API_VERSION ? api : null;
}
