import { PROVIDERS } from '../issues/providers.ts';
import type { Project, ProviderId } from '../issues/types.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike } from './adapter.ts';
import { LookupPicker } from './lookup-picker.ts';
import type { IssueRef } from './issue-ref.ts';
import { projectMarker } from './project-card.ts';
import { addRefNode, findRefNode } from './ref-node.ts';

export function projectRef(provider: ProviderId, project: Project): IssueRef {
  return { provider, kind: 'project', id: project.id, identifier: '', title: project.name, url: project.url };
}

/**
 * The picker for adding a project (Linear's or Task App's): search by words, or give a project's URL. With nothing
 * typed it lists the projects updated most recently.
 */
export function projectPicker(
  plugin: CanvasPlusPlugin, provider: ProviderId, canvas: CanvasLike, at: { x: number; y: number } | null, onAdded: () => void,
): LookupPicker<Project> {
  const { client } = plugin.issues[provider];
  return new LookupPicker<Project>(plugin, canvas, at, onAdded, {
    noun: 'project',
    placeholder: `Search ${PROVIDERS[provider].name} projects, or enter a project URL…`,
    parse: (text) => client.parseProjectRef(text),
    byRef: (ref) => client.projectByRef(ref),
    search: (term) => client.searchProjects(term),
    recent: () => client.recentProjects(),
    existing: (c, project) => findProjectNode(c, provider, project.id),
    add: (c, project, pos) => addProjectNode(plugin, provider, c, project, pos),
    mark: projectMarker,
    title: (project) => project.name,
  });
}

/** The node already showing this project, if any. */
export function findProjectNode(canvas: CanvasLike, provider: ProviderId, id: string): CanvasNodeLike | undefined {
  return findRefNode(canvas, 'project', provider, id);
}

/** Add a card for a project, as one undo step. `at` is where its centre goes; without it, the nearest free spot to the middle of the view. */
export function addProjectNode(
  plugin: CanvasPlusPlugin, provider: ProviderId, canvas: CanvasLike, project: Project, at: { x: number; y: number } | null,
): CanvasNodeLike | undefined {
  // Known before the card is drawn, so it shows the project at once.
  plugin.projects[provider].put(project);
  return addRefNode(canvas, projectRef(provider, project), PROVIDERS[provider].projectField, at);
}
