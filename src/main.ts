import { Plugin } from 'obsidian';
import { registerCanvasTools } from './canvas/index.ts';
import { LinearClient } from './linear/api.ts';
import { LinearAuth, PROTOCOL_ACTION } from './linear/oauth.ts';
import { LinearStore } from './linear/store.ts';
import { NO_NOTE_TYPES, NoteTypesApi, findNoteTypesApi } from './note-types.ts';
import { PluginData } from './plugin-data.ts';
import { CanvasPlusSettingTab, CanvasPlusSettings, DEFAULT_SETTINGS } from './settings.ts';

export class CanvasPlusPlugin extends Plugin {
  pluginData!: PluginData;
  linear!: { auth: LinearAuth; client: LinearClient; store: LinearStore };

  /** Note Types, or a stand-in that turns the typed-note features off when it isn't enabled. */
  get types(): NoteTypesApi {
    return findNoteTypesApi(this.app) ?? NO_NOTE_TYPES;
  }

  /** Whether Note Types is enabled, so note cards, relations and key images are available. */
  get hasNoteTypes(): boolean {
    return findNoteTypesApi(this.app) !== null;
  }

  get config(): CanvasPlusSettings {
    return { ...DEFAULT_SETTINGS, ...(this.pluginData.root.settings as Partial<CanvasPlusSettings> | undefined) };
  }

  updateConfig(patch: Partial<CanvasPlusSettings>): void {
    this.pluginData.root.settings = { ...this.config, ...patch };
    this.pluginData.save();
  }

  /** Whether signed in to Linear (or an API key is set), so Linear issues are available. */
  get hasLinear(): boolean {
    return this.linear.client.configured;
  }

  private apiKey(): string | null {
    const name = this.config.linearKeySecret;
    return name ? this.app.secretStorage.getSecret(name) || null : null;
  }

  async onload(): Promise<void> {
    this.pluginData = new PluginData(this);
    await this.pluginData.ready;
    const auth = new LinearAuth(this.app, {
      enabled: () => this.config.linearEnabled,
      clientId: () => this.config.linearClientId.trim(),
      apiKey: () => this.apiKey(),
      expiresAt: () => this.config.linearExpiresAt,
      setExpiresAt: (at) => this.updateConfig({ linearExpiresAt: at }),
    });
    const client = new LinearClient(auth);
    this.linear = { auth, client, store: new LinearStore(client) };
    this.registerObsidianProtocolHandler(PROTOCOL_ACTION, (data) => { void auth.finish(data); });
    this.register(() => this.linear.store.destroy());
    this.addSettingTab(new CanvasPlusSettingTab(this));
    registerCanvasTools(this);
  }
}

export default CanvasPlusPlugin;
