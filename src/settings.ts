import { Notice, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import { REDIRECT_URI } from './linear/oauth.ts';
import { PROVIDERS } from './issues/providers.ts';
import type { ProviderId } from './issues/types.ts';
import type { CanvasPlusPlugin } from './main.ts';

export interface CanvasPlusSettings {
  /** The name of the secret holding the Linear API key, in Obsidian's secret storage. The key itself is never kept here. */
  linearKeySecret: string;
  /** Beta: the Linear features are off until this is turned on. */
  linearEnabled: boolean;
  /** The client ID of the Linear OAuth app used to sign in. */
  linearClientId: string;
  /** When the sign-in's access token runs out (ms since epoch). The tokens themselves are kept in secret storage. */
  linearExpiresAt: number;
  /** The team new issues are created in, or empty to ask each time. */
  linearTeamId: string;
  /** Beta: the Task App features are off until this is turned on. */
  taskAppEnabled: boolean;
  /** Where the Task App API runs. */
  taskAppUrl: string;
  /** Where the Task App web app runs, when that isn't the same place as the API. Issue links use it. */
  taskAppWebUrl: string;
  /** The name of the secret holding the Task App API token, in Obsidian's secret storage. */
  taskAppTokenSecret: string;
  /** The team new Task App issues are created in, or empty to ask each time. */
  taskAppTeamId: string;
}

export const DEFAULT_SETTINGS: CanvasPlusSettings = {
  linearKeySecret: '',
  linearEnabled: false,
  linearClientId: '',
  linearExpiresAt: 0,
  linearTeamId: '',
  taskAppEnabled: false,
  taskAppUrl: '',
  taskAppWebUrl: '',
  taskAppTokenSecret: '',
  taskAppTeamId: '',
};

export class CanvasPlusSettingTab extends PluginSettingTab {
  constructor(private plugin: CanvasPlusPlugin) {
    super(plugin.app, plugin);
  }

  private unwatch: (() => void) | null = null;

  private stopWatching(): void {
    this.unwatch?.();
    this.unwatch = null;
  }

  hide(): void {
    this.stopWatching();
  }

  display(): void {
    this.containerEl.empty();
    this.stopWatching();
    this.displayLinear();
    this.displayTaskApp();
  }

  private displayLinear(): void {
    const { containerEl } = this;
    new Setting(containerEl).setName('Linear').setHeading();

    new Setting(containerEl)
      .setName('Enable Linear integration (beta)')
      .setDesc('Beta: this may change or break between versions. Adds Linear issues to a canvas, creates issues from cards, and shows issues as a card, embed or link. Nothing is sent to Linear until you turn this on and sign in.')
      .addToggle((t) => t
        .setValue(this.plugin.config.linearEnabled)
        .onChange((on) => {
          this.plugin.updateConfig({ linearEnabled: on });
          this.display();
        }));

    if (!this.plugin.config.linearEnabled) return;

    const { auth } = this.plugin.linear;
    this.unwatch = auth.onChange(() => this.display());

    new Setting(containerEl)
      .setName('OAuth client ID')
      .setDesc(`The client ID of a Linear OAuth app (Linear → Settings → API → OAuth applications). Give the app this callback URL: ${REDIRECT_URI}`)
      .addText((t) => t
        .setValue(this.plugin.config.linearClientId)
        .onChange((v) => this.plugin.updateConfig({ linearClientId: v.trim() })));

    new Setting(containerEl)
      .setName(auth.signedIn ? 'Signed in to Linear' : 'Sign in')
      .setDesc('Opens Linear in your browser to approve access. Requests go only to Linear, when you add, create or show Linear issues on a canvas.')
      .addButton((b) => {
        if (auth.signedIn) b.setButtonText('Sign out').onClick(() => { void auth.signOut(); });
        else b.setButtonText('Sign in').setCta().onClick(() => { void auth.start(); });
      });

    new Setting(containerEl)
      .setName('Personal API key')
      .setDesc('Instead of signing in: a personal API key, created in Linear under account security settings. It is kept in Obsidian secret storage. A sign-in is used first when both are set.')
      .addComponent((el) => new SecretComponent(this.app, el)
        .setValue(this.plugin.config.linearKeySecret)
        .onChange((name) => {
          this.plugin.updateConfig({ linearKeySecret: name ?? '' });
          this.display();
        }));

    if (this.plugin.hasLinear) this.teamSetting('linear');
  }

  /** The default team for a provider's new issues, once its team list has loaded. */
  private teamSetting(id: ProviderId): void {
    const key = id === 'linear' ? 'linearTeamId' : 'taskAppTeamId';
    const setting = new Setting(this.containerEl)
      .setName('Default team')
      .setDesc('The team new issues are created in.');
    setting.addDropdown((dropdown) => {
      dropdown.addOption('', 'Ask each time');
      dropdown.setValue('');
      dropdown.onChange((value) => this.plugin.updateConfig({ [key]: value }));
      this.plugin.issues[id].client.teams()
        .then((teams) => {
          for (const team of teams) dropdown.addOption(team.id, `${team.name} (${team.key})`);
          dropdown.setValue(this.plugin.config[key]);
        })
        .catch((err: Error) => {
          setting.setDesc(`Could not load teams: ${err.message}`);
          new Notice(`${PROVIDERS[id].name}: ${err.message}`);
        });
    });
  }

  private displayTaskApp(): void {
    const { containerEl } = this;
    new Setting(containerEl).setName('Task App').setHeading();

    new Setting(containerEl)
      .setName('Enable Task App integration (beta)')
      .setDesc('Beta: this may change or break between versions. Adds Task App issues to a canvas, creates issues from cards, and shows issues as a card, embed or link. Nothing is sent to your Task App server until you turn this on and set its address.')
      .addToggle((t) => t
        .setValue(this.plugin.config.taskAppEnabled)
        .onChange((on) => {
          this.plugin.updateConfig({ taskAppEnabled: on });
          this.display();
        }));
    if (!this.plugin.config.taskAppEnabled) return;

    new Setting(containerEl)
      .setName('Server address')
      .setDesc('Where the Task App API runs, such as https://tasks.example.com, or http://localhost:4100 on this computer.')
      .addText((t) => t
        .setPlaceholder('https://tasks.example.com')
        .setValue(this.plugin.config.taskAppUrl)
        .onChange((v) => this.plugin.updateConfig({ taskAppUrl: v.trim() })));

    new Setting(containerEl)
      .setName('Web app address')
      .setDesc('Only if the web app is somewhere other than the server, such as http://localhost:3100 while developing. Issue links use it.')
      .addText((t) => t
        .setValue(this.plugin.config.taskAppWebUrl)
        .onChange((v) => this.plugin.updateConfig({ taskAppWebUrl: v.trim() })));

    new Setting(containerEl)
      .setName('API token')
      .setDesc('The server\'s API_TOKEN, which a hosted server needs; leave it empty for a local server with sign-in off. It is kept in Obsidian secret storage. Requests go only to the server address above, when you add, create or show Task App issues on a canvas.')
      .addComponent((el) => new SecretComponent(this.app, el)
        .setValue(this.plugin.config.taskAppTokenSecret)
        .onChange((name) => {
          this.plugin.updateConfig({ taskAppTokenSecret: name ?? '' });
          this.display();
        }));

    if (this.plugin.hasTaskApp) this.teamSetting('taskapp');
  }
}
