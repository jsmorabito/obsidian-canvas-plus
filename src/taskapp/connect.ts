import { ButtonComponent, Modal, Notice, ObsidianProtocolData } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { cleanUrl } from './client.ts';

/**
 * Task App's **Connect Obsidian** button opens `obsidian://canvas-plus-taskapp?url=<server>&token=<API token>`.
 * Nothing is saved until the person confirms, so a link from anywhere else can't change where requests go.
 */
export const TASKAPP_PROTOCOL_ACTION = 'canvas-plus-taskapp';

/** Where the token is kept in Obsidian's secret storage. */
const TOKEN_SECRET = 'canvas-plus-taskapp-token';

export function handleConnect(plugin: CanvasPlusPlugin, data: ObsidianProtocolData): void {
  const url = cleanUrl(data.url ?? '');
  if (!url) {
    new Notice('Task App connect link has no valid server address.');
    return;
  }
  new ConnectModal(plugin, url, data.token ?? '').open();
}

class ConnectModal extends Modal {
  constructor(private plugin: CanvasPlusPlugin, private url: string, private token: string) {
    super(plugin.app);
  }

  onOpen(): void {
    this.setTitle('Connect Task App');
    const { contentEl } = this;
    contentEl.empty();
    const current = cleanUrl(this.plugin.config.taskAppUrl);
    contentEl.createEl('p', { text: 'Canvas Plus will send your Task App requests to:' });
    contentEl.createEl('p').createEl('strong', { text: this.url });
    contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: this.token
        ? 'It will keep the API token from the link in Obsidian secret storage and turn the Task App integration on.'
        : 'The link has no API token, so none will be used. That works for a local server with sign-in off.',
    });
    if (current && current !== this.url) {
      contentEl.createEl('p', { cls: 'setting-item-description', text: `This replaces ${current}.` });
    }
    contentEl.createEl('p', { cls: 'setting-item-description', text: 'Only connect if you opened this link from your own Task App.' });
    const row = contentEl.createDiv({ cls: 'modal-button-container' });
    new ButtonComponent(row).setButtonText('Connect').setCta().onClick(() => {
      this.connect();
      this.close();
    });
    new ButtonComponent(row).setButtonText('Cancel').onClick(() => this.close());
  }

  private connect(): void {
    const { app } = this.plugin;
    if (this.token) app.secretStorage.setSecret(TOKEN_SECRET, this.token);
    this.plugin.updateConfig({
      taskAppEnabled: true,
      taskAppUrl: this.url,
      // The link carries one address; the web app is served from it, so a separate web address no longer applies.
      taskAppWebUrl: '',
      taskAppTokenSecret: this.token ? TOKEN_SECRET : '',
      taskAppTeamId: '',
    });
    new Notice('Connected to Task App.');
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
