import { ButtonComponent, Modal, Notice, Setting } from 'obsidian';
import { PROVIDERS } from '../issues/providers.ts';
import type { Issue, ProviderId } from '../issues/types.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike, batch, patchData } from './adapter.ts';
import { FIELD_KIND, KIND_TEXT } from './constants.ts';
import { readInk } from './ink-nodes.ts';
import { isAnchor } from './anchor.ts';
import { firstLine } from './layers-tree.ts';
import { issueNodeText, readIssueRef } from './issue-ref.ts';
import { issueRef } from './issue-picker.ts';

/** Linear's limit on an issue's title, kept for Task App's too. */
const MAX_TITLE = 255;

/** A card that can become an issue: a text card with something in it, not free text, a drawing, an anchor or an issue already. */
export function isConvertibleCard(node: CanvasNodeLike): boolean {
  const data = node.getData?.();
  if (!data || data.type !== 'text') return false;
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text || /^!\[[^\]]*\]\(/.test(text)) return false;
  return !readInk(node, data) && !isAnchor(node, data) && data[FIELD_KIND] !== KIND_TEXT && !readIssueRef(node, data);
}

export interface Draft {
  node: CanvasNodeLike;
  title: string;
  description: string;
}

/** The first line of a card is the issue's title, and the rest its description. */
export function draftFrom(node: CanvasNodeLike): Draft {
  const text = (node.getData?.().text as string | undefined) ?? '';
  const lines = text.trim().split('\n');
  const title = firstLine(text);
  const description = lines.slice(1).join('\n').trim();
  if (title.length <= MAX_TITLE) return { node, title, description };
  // Too long for a title: shorten it and keep all of the card's text in the description.
  return { node, title: `${title.slice(0, MAX_TITLE - 1)}…`, description: text.trim() };
}

/** Ask where to create issues for the cards, create them, and turn the cards into issue cards. */
export function createIssuesFromCards(plugin: CanvasPlusPlugin, provider: ProviderId, canvas: CanvasLike, nodes: CanvasNodeLike[], onDone: () => void): void {
  const drafts = nodes.filter(isConvertibleCard).map(draftFrom);
  if (drafts.length === 0) return;
  new CreateIssuesModal(plugin, provider, canvas, drafts, onDone).open();
}

class CreateIssuesModal extends Modal {
  private teamId = '';
  private get teamKey(): 'linearTeamId' | 'taskAppTeamId' {
    return this.provider === 'linear' ? 'linearTeamId' : 'taskAppTeamId';
  }
  private busy = false;

  constructor(
    private plugin: CanvasPlusPlugin,
    private provider: ProviderId,
    private canvas: CanvasLike,
    private drafts: Draft[],
    private onDone: () => void,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    const many = this.drafts.length > 1;
    const name = PROVIDERS[this.provider].name;
    this.setTitle(many ? `Create ${this.drafts.length} ${name} issues` : `Create ${name} issue`);
    const { contentEl } = this;
    contentEl.empty();

    const teamSetting = new Setting(contentEl).setName('Team');
    teamSetting.addDropdown((d) => d.addOption('', 'Loading teams…').setDisabled(true));

    if (many) {
      const list = contentEl.createEl('ul', { cls: 'ffc-issue-drafts' });
      for (const d of this.drafts) list.createEl('li', { text: d.title });
    } else {
      const draft = this.drafts[0];
      new Setting(contentEl).setName('Title').addText((t) => {
        t.setValue(draft.title).onChange((v) => { draft.title = v; });
        t.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void this.submit(); }
        });
      }).controlEl.addClass('ffc-issue-field');
      new Setting(contentEl).setName('Description').addTextArea((t) => {
        t.setValue(draft.description).onChange((v) => { draft.description = v; });
        t.inputEl.rows = 6;
      }).controlEl.addClass('ffc-issue-field');
    }

    const create: { button?: ButtonComponent } = {};
    new Setting(contentEl)
      .addButton((b) => { create.button = b.setButtonText('Create').setCta().setDisabled(true).onClick(() => { void this.submit(); }); })
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));

    this.plugin.issues[this.provider].client.teams()
      .then((teams) => {
        const wanted = this.plugin.config[this.teamKey];
        this.teamId = teams.some((t) => t.id === wanted) ? wanted : teams[0]?.id ?? '';
        teamSetting.clear();
        teamSetting.setName('Team').addDropdown((d) => {
          for (const team of teams) d.addOption(team.id, `${team.name} (${team.key})`);
          d.setValue(this.teamId).onChange((v) => { this.teamId = v; });
        });
        if (teams.length === 0) teamSetting.setDesc(`${name} has no teams to create issues in.`);
        else create.button?.setDisabled(false);
      })
      .catch((err: Error) => {
        teamSetting.setDesc(`Could not load teams: ${err.message}`);
      });
  }

  private async submit(): Promise<void> {
    if (this.busy || !this.teamId) return;
    const drafts = this.drafts.filter((d) => d.title.trim());
    if (drafts.length === 0) {
      new Notice('Give the issue a title.');
      return;
    }
    this.busy = true;
    this.contentEl.addClass('is-busy');
    const { client, store } = this.plugin.issues[this.provider];
    const created: Array<{ draft: Draft; issue: Issue }> = [];
    let failure: Error | null = null;
    try {
      for (const draft of drafts) {
        const issue = await client.create({ teamId: this.teamId, title: draft.title.trim(), description: draft.description.trim() || undefined });
        store.put(issue);
        created.push({ draft, issue });
      }
    } catch (err) {
      failure = err as Error;
    }
    if (created.length > 0) {
      this.plugin.updateConfig({ [this.teamKey]: this.teamId });
      // A card removed while waiting stays removed.
      const live = created.filter(({ draft }) => draft.node.id && this.canvas.nodes?.get(draft.node.id) === draft.node);
      batch(this.canvas, () => {
        for (const { draft, issue } of live) {
          const ref = issueRef(this.provider, issue);
          patchData(draft.node, { text: issueNodeText(ref), [PROVIDERS[this.provider].field]: ref });
        }
      });
      new Notice(`Created ${created.map((c) => c.issue.identifier).join(', ')} in ${PROVIDERS[this.provider].name}.`);
    }
    if (failure) new Notice(`${PROVIDERS[this.provider].name}: ${failure.message}`);
    this.busy = false;
    this.close();
    this.onDone();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
