import { Plugin } from 'obsidian';
import { registerCanvasTools } from './canvas/index.ts';
import { NO_NOTE_TYPES, NoteTypesApi, findNoteTypesApi } from './note-types.ts';

export class CanvasPlusPlugin extends Plugin {
  /** Note Types, or a stand-in that turns the typed-note features off when it isn't enabled. */
  get types(): NoteTypesApi {
    return findNoteTypesApi(this.app) ?? NO_NOTE_TYPES;
  }

  /** Whether Note Types is enabled, so note cards, relations and key images are available. */
  get hasNoteTypes(): boolean {
    return findNoteTypesApi(this.app) !== null;
  }

  onload(): void {
    registerCanvasTools(this);
  }
}

export default CanvasPlusPlugin;
