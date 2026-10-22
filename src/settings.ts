import { Notice, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import { REDIRECT_URI } from './linear/oauth.ts';
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
}

export const DEFAULT_SETTINGS: CanvasPlusSettings = {
  linearKeySecret: '',
  linearEnabled: false,
  linearClientId: '',
  linearExpiresAt: 0,
  linearTeamId: '',
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
    const { containerEl } = this;
    containerEl.empty();

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

    this.stopWatching();
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

    if (!this.plugin.hasLinear) return;

    const teamSetting = new Setting(containerEl)
      .setName('Default team')
      .setDesc('The team new issues are created in.');
    teamSetting.addDropdown((dropdown) => {
      dropdown.addOption('', 'Ask each time');
      dropdown.setValue('');
      dropdown.onChange((value) => this.plugin.updateConfig({ linearTeamId: value }));
      this.plugin.linear.client.teams()
        .then((teams) => {
          for (const team of teams) dropdown.addOption(team.id, `${team.name} (${team.key})`);
          dropdown.setValue(this.plugin.config.linearTeamId);
        })
        .catch((err: Error) => {
          teamSetting.setDesc(`Could not load teams: ${err.message}`);
          new Notice(`Linear: ${err.message}`);
        });
    });
  }
}
