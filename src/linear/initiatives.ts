import type { Initiative } from '../issues/types.ts';

// How Linear's initiatives are asked for and read. The client that sends the requests is in api.ts.

export interface RawInitiative extends Omit<Initiative, 'description' | 'content' | 'projects'> {
  description: string | null;
  content: string | null;
  projects?: { nodes: Array<{ name: string }> };
}

export const INITIATIVE_FIELDS = `fragment InitiativeFields on Initiative {
  id name url description content icon color status targetDate updatedAt
  owner { name avatarUrl }
  projects { nodes { name } }
}`;

export function toInitiative(raw: RawInitiative): Initiative {
  return { ...raw, description: raw.description ?? '', content: raw.content ?? '', projects: raw.projects?.nodes.map((p) => p.name) ?? [] };
}

export const INITIATIVE_URL_RE = /^https:\/\/linear\.app\/[^/]+\/initiative\/([^/?#]+)/;
