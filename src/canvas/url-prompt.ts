import { App, Modal, Setting } from 'obsidian';

/** Ask for the web address a node's text opens. Saving it empty removes the link, when there was one. */
export class UrlPrompt extends Modal {
  constructor(app: App, private initial: string, private onSubmit: (url: string) => void) {
    super(app);
  }

  /** A web address as typed: `example.com` counts as `https://example.com`, and anything that isn't a web address is null. */
  static normalize(text: string): string | null {
    const t = text.trim();
    if (!t) return null;
    const typed = /^https?:\/\//i.test(t);
    const url = typed ? t : `${/^localhost(?:[:/]|$)/i.test(t) ? 'http' : 'https'}://${t}`;
    try {
      const { hostname } = new URL(url);
      // Without a scheme, a lone word isn't taken for an address.
      return typed || hostname.includes('.') || hostname === 'localhost' ? url : null;
    } catch {
      return null;
    }
  }

  onOpen(): void {
    this.setTitle('Link to a web address');
    let value = this.initial;
    const submit = (): void => {
      const url = value.trim() === '' ? '' : UrlPrompt.normalize(value);
      if (url === null) {
        error.setText('Enter a valid web address.');
        return;
      }
      this.close();
      this.onSubmit(url);
    };
    new Setting(this.contentEl).setName('Address').addText((text) => {
      text.setPlaceholder('https://example.com').setValue(value).onChange((v) => { value = v; });
      text.inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });
      window.setTimeout(() => { text.inputEl.focus(); text.inputEl.select(); }, 0);
    });
    const error = this.contentEl.createDiv({ cls: 'mod-warning' });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Save').setCta().onClick(submit))
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
