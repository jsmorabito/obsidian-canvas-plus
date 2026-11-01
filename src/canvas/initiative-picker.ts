import type { Initiative } from '../issues/types.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike } from './adapter.ts';
import { FIELD_LINEAR_INITIATIVE } from './constants.ts';
import { initiativeMarker } from './initiative-card.ts';
import type { IssueRef } from './issue-ref.ts';
import { LookupPicker } from './lookup-picker.ts';
import { addRefNode, findRefNode } from './ref-node.ts';

export function initiativeRef(initiative: Initiative): IssueRef {
  return { provider: 'linear', kind: 'initiative', id: initiative.id, identifier: '', title: initiative.name, url: initiative.url };
}

/**
 * The picker for adding a Linear initiative: search by name, or give an initiative's URL. With nothing typed it lists
 * the initiatives updated most recently.
 */
export function initiativePicker(
  plugin: CanvasPlusPlugin, canvas: CanvasLike, at: { x: number; y: number } | null, onAdded: () => void,
): LookupPicker<Initiative> {
  const { client } = plugin.linear;
  return new LookupPicker<Initiative>(plugin, canvas, at, onAdded, {
    noun: 'initiative',
    placeholder: 'Search Linear initiatives, or enter an initiative URL…',
    parse: (text) => client.parseInitiativeRef(text),
    byRef: (ref) => client.initiativeByRef(ref),
    search: (term) => client.searchInitiatives(term),
    recent: () => client.recentInitiatives(),
    existing: (c, initiative) => findInitiativeNode(c, initiative.id),
    add: (c, initiative, pos) => {
      // Known before the card is drawn, so it shows the initiative at once.
      plugin.initiatives.put(initiative);
      return addRefNode(c, initiativeRef(initiative), FIELD_LINEAR_INITIATIVE, pos);
    },
    mark: initiativeMarker,
    title: (initiative) => initiative.name,
  });
}

/** The node already showing this initiative, if any. */
export function findInitiativeNode(canvas: CanvasLike, id: string): CanvasNodeLike | undefined {
  return findRefNode(canvas, 'initiative', 'linear', id);
}
