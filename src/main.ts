import { Plugin } from 'obsidian';
import { registerCanvasTools } from './canvas/index.ts';
import { ISSUE_VIEWS } from './canvas/issue-view.ts';
import { registerHtmlEmbed } from './html/embed.ts';
import { HTML_EXTENSIONS, HTML_VIEW, HtmlView } from './html/view.ts';
import { hiddenWidgets } from './canvas/widgets.ts';
import { IssueService, PROVIDERS, PROVIDER_IDS } from './issues/providers.ts';
import { IssueStore } from './issues/store.ts';
import type { Initiative, Issue, ProjectClient, RefItem, ProviderId, Project } from './issues/types.ts';
import type { IssueRef } from './canvas/issue-ref.ts';
import { LinearClient } from './linear/api.ts';
import { LinearAuth, PROTOCOL_ACTION } from './linear/oauth.ts';
import { TaskAppClient } from './taskapp/client.ts';
import { TASKAPP_PROTOCOL_ACTION, handleConnect } from './taskapp/connect.ts';
import { hasDiscourseGraphs } from './discourse-graphs.ts';
import { NO_NOTE_TYPES, NoteTypesApi, findNoteTypesApi } from './note-types.ts';
import { PluginData } from './plugin-data.ts';
import { CanvasPlusSettingTab, CanvasPlusSettings, DEFAULT_SETTINGS } from './settings.ts';

export class CanvasPlusPlugin extends Plugin {
  pluginData!: PluginData;
  linear!: { auth: LinearAuth; client: LinearClient };
  taskApp!: { client: TaskAppClient };
  /** Each provider's client and the issues it has fetched. */
  issues!: Record<ProviderId, IssueService>;
  /** Each provider's projects on canvases, fetched the same way. */
  projects!: Record<ProviderId, IssueStore<Project>>;
  /** Linear's initiatives on canvases, fetched the same way. */
  initiatives!: IssueStore<Initiative>;
  /** Restyle every open canvas now. Set by the canvas tools. */
  sweepCanvases: () => void = () => { /* no canvas tools yet */ };

  /** Note Types, or a stand-in that turns the typed-note features off when it isn't enabled. */
  get types(): NoteTypesApi {
    return findNoteTypesApi(this.app) ?? NO_NOTE_TYPES;
  }

  /** Whether Note Types is enabled, so note cards, relations and key images are available. */
  get hasNoteTypes(): boolean {
    return findNoteTypesApi(this.app) !== null;
  }

  /** Whether Discourse Graphs is enabled, so discourse nodes can be made and explored. */
  get hasDiscourseGraphs(): boolean {
    return hasDiscourseGraphs(this.app);
  }

  get config(): CanvasPlusSettings {
    return { ...DEFAULT_SETTINGS, ...(this.pluginData.root.settings as Partial<CanvasPlusSettings> | undefined) };
  }

  updateConfig(patch: Partial<CanvasPlusSettings>): void {
    this.pluginData.root.settings = { ...this.config, ...patch };
    this.pluginData.save();
    this.syncWidgets();
  }

  /** A provider's widget is listed under Open widget only while its integration is turned on. */
  private syncWidgets(): void {
    const on: Record<ProviderId, boolean> = { linear: this.config.linearEnabled, taskapp: this.config.taskAppEnabled };
    for (const id of PROVIDER_IDS) {
      if (on[id]) hiddenWidgets.delete(PROVIDERS[id].viewType);
      else hiddenWidgets.add(PROVIDERS[id].viewType);
    }
  }

  /** Where what a node shows is kept, by the kind of thing it is. */
  storeFor(ref: IssueRef): IssueStore<Issue | Project | Initiative> {
    if (ref.kind === 'initiative') return this.initiatives;
    return ref.kind === 'project' ? this.projects[ref.provider] : this.issues[ref.provider].store;
  }

  /** What the service returned for what a node shows, or undefined until it has loaded. */
  itemOf(ref: IssueRef): RefItem | undefined {
    if (ref.kind === 'initiative') {
      const item = this.initiatives.get(ref.id);
      return item && { kind: 'initiative', item };
    }
    if (ref.kind === 'project') {
      const item = this.projects[ref.provider].get(ref.id);
      return item && { kind: 'project', item };
    }
    const item = this.issues[ref.provider].store.get(ref.id);
    return item && { kind: 'issue', item };
  }

  /** Whether a provider is turned on and signed in (or keyed), so its issues are available. */
  hasIssues(id: ProviderId): boolean {
    return this.issues[id].client.configured;
  }

  /** Whether signed in to Linear (or an API key is set), so Linear issues are available. */
  get hasLinear(): boolean {
    return this.hasIssues('linear');
  }

  /** Whether Task App is turned on with a server address, so Task App issues are available. */
  get hasTaskApp(): boolean {
    return this.hasIssues('taskapp');
  }

  /** The secret a setting names, from Obsidian's secret storage. */
  private secret(name: string): string | null {
    return name ? this.app.secretStorage.getSecret(name) || null : null;
  }

  async onload(): Promise<void> {
    this.pluginData = new PluginData(this);
    await this.pluginData.ready;
    const auth = new LinearAuth(this.app, {
      enabled: () => this.config.linearEnabled,
      clientId: () => this.config.linearClientId.trim(),
      apiKey: () => this.secret(this.config.linearKeySecret),
      expiresAt: () => this.config.linearExpiresAt,
      setExpiresAt: (at) => this.updateConfig({ linearExpiresAt: at }),
    });
    const linear = new LinearClient(auth);
    this.linear = { auth, client: linear };
    const taskApp = new TaskAppClient({
      enabled: () => this.config.taskAppEnabled,
      serverUrl: () => this.config.taskAppUrl,
      webUrl: () => this.config.taskAppWebUrl,
      token: () => this.secret(this.config.taskAppTokenSecret),
    });
    this.taskApp = { client: taskApp };
    this.issues = {
      linear: { info: PROVIDERS.linear, client: linear, store: new IssueStore(linear) },
      taskapp: { info: PROVIDERS.taskapp, client: taskApp, store: new IssueStore(taskApp) },
    };
    const projectStore = (client: ProjectClient): IssueStore<Project> => new IssueStore<Project>({
      get configured() { return client.configured; },
      byIds: (ids) => client.projectsByIds(ids),
    });
    this.projects = { linear: projectStore(linear), taskapp: projectStore(taskApp) };
    this.initiatives = new IssueStore<Initiative>({
      get configured() { return linear.configured; },
      byIds: (ids) => linear.initiativesByIds(ids),
    });
    this.register(() => this.initiatives.destroy());
    this.registerObsidianProtocolHandler(PROTOCOL_ACTION, (data) => { void auth.finish(data); });
    this.registerObsidianProtocolHandler(TASKAPP_PROTOCOL_ACTION, (data) => { handleConnect(this, data); });
    for (const id of PROVIDER_IDS) {
      this.register(() => this.issues[id].store.destroy());
      this.register(() => this.projects[id].destroy());
      this.registerView(PROVIDERS[id].viewType, (leaf) => new ISSUE_VIEWS[id](leaf, this));
      this.register(() => hiddenWidgets.delete(PROVIDERS[id].viewType));
    }
    this.registerView(HTML_VIEW, (leaf) => new HtmlView(leaf));
    try {
      this.registerExtensions(HTML_EXTENSIONS, HTML_VIEW);
    } catch {
      // Another plugin already opens HTML files.
    }
    registerHtmlEmbed(this);
    this.syncWidgets();
    this.addSettingTab(new CanvasPlusSettingTab(this));
    registerCanvasTools(this);
  }
}

export default CanvasPlusPlugin;
