import { FIELD_LINEAR, FIELD_LINEAR_INITIATIVE, FIELD_LINEAR_PROJECT, FIELD_TASKAPP, FIELD_TASKAPP_PROJECT } from '../canvas/constants.ts';
import { LINEAR_ICON, TASKAPP_ICON } from '../canvas/icons.ts';
import type { IssueClient, ProjectClient, ProviderId, ProviderInfo } from './types.ts';
import type { IssueStore } from './store.ts';

export const LINEAR_VIEW_TYPE = 'canvas-plus-linear';
export const TASKAPP_VIEW_TYPE = 'canvas-plus-taskapp';

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  linear: { id: 'linear', name: 'Linear', icon: LINEAR_ICON, field: FIELD_LINEAR, projectField: FIELD_LINEAR_PROJECT, initiativeField: FIELD_LINEAR_INITIATIVE, viewType: LINEAR_VIEW_TYPE },
  taskapp: { id: 'taskapp', name: 'Task App', icon: TASKAPP_ICON, field: FIELD_TASKAPP, projectField: FIELD_TASKAPP_PROJECT, viewType: TASKAPP_VIEW_TYPE },
};

/** Every provider, in the order they are listed. */
export const PROVIDER_IDS: readonly ProviderId[] = ['linear', 'taskapp'];

/** A provider's client and what it has fetched, with how it is shown. */
export interface IssueService {
  info: ProviderInfo;
  client: IssueClient & ProjectClient;
  store: IssueStore;
}
