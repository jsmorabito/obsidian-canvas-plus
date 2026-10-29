import { Menu, setIcon } from 'obsidian';
import { CanvasLike, CanvasNodeLike, CanvasViewLike, afterCanvasFrame, batch, shieldFromCanvas, toCanvasPoint } from './adapter.ts';
import { CLICK_SLOP_PX } from './constants.ts';
import { createPinBubble } from './pin-bubble.ts';
import { trackPointer } from './pointer-session.ts';
import type { Tray } from './tray.ts';
import { CanvasComment, CommentMessage, movedTo, newCommentId, nodeUnder, pinPoint, readComments, timeAgo, writeComments } from './comments.ts';

const TARGET_CLASS = 'ffc-comment-target';
type Placement = Pick<CanvasComment, 'x' | 'y' | 'node' | 'dx' | 'dy'>;

const AUTHOR = 'You';

/**
 * Comment pins over the canvas, like Figma's. A pin is a small bubble at a canvas point; hovering it previews the
 * thread, and selecting it opens the whole thread to reply to, resolve or delete. The comment tool drops a new
 * pin and asks for its first message. They are saved in the canvas file, so undo covers them too.
 */
export class CommentLayer {
  private el: HTMLElement;
  /** Where each drawn pin is, in canvas units, to place it again as the view moves. */
  private placed = new Map<HTMLElement, Placement>();
  private drawn: CanvasComment[] | null = null;
  private openId: string | null = null;
  /** A new pin waiting for its first message. */
  private draft: { x: number; y: number } | null = null;
  /** The press that made the draft, which the click-away listener must not take for a press elsewhere. */
  private draftStamp = 0;
  private cleanups: Array<() => void> = [];
  private endDrag: (() => void) | null = null;
  private tray: Tray | null = null;
  /** Where the canvas sits in this layer, and how wide it is. Reading it forces a layout, so it's kept until a resize. */
  private frame: { left: number; top: number; width: number } | null = null;
  /** What each pin was last given, so a frame that didn't move it writes nothing. */
  private lastPlace = new WeakMap<HTMLElement, string>();

  constructor(private view: CanvasViewLike) {
    const canvas = view.canvas!;
    this.el = view.contentEl.createDiv({ cls: 'ffc-comments' });
    shieldFromCanvas(this.el);
    // A press anywhere else on the canvas puts the open thread (or an unsent pin) away.
    const away = (e: PointerEvent): void => {
      if (e.timeStamp !== this.draftStamp) this.dismiss();
    };
    canvas.wrapperEl.addEventListener('pointerdown', away, true);
    this.cleanups.push(() => canvas.wrapperEl.removeEventListener('pointerdown', away, true));
    const resizes = new ResizeObserver(() => { this.frame = null; });
    resizes.observe(canvas.wrapperEl);
    resizes.observe(this.el);
    this.cleanups.push(() => resizes.disconnect());
    this.cleanups.push(afterCanvasFrame(canvas, () => this.sync()));
    this.sync();
  }

  private get canvas(): CanvasLike { return this.view.canvas!; }

  /** The tray (and its dock) a dragged pin can be dropped on. */
  setTray(tray: Tray): void {
    this.tray = tray;
  }

  /** Start a new pin at a canvas point, asking for its first message. `stamp` is the time of the press that made it. */
  beginDraft(at: { x: number; y: number }, stamp: number): void {
    this.draftStamp = stamp;
    this.draft = at;
    this.openId = null;
    this.render(true);
  }

  /** Put away the open thread or the unsent pin. Returns whether there was one. */
  dismiss(): boolean {
    if (!this.draft && this.openId === null) return false;
    this.draft = null;
    this.openId = null;
    this.render();
    return true;
  }

  destroy(): void {
    this.endDrag?.();
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    this.el.remove();
  }

  /** Redraw when the comments have changed (an undo, or the file reloading), else just keep the pins where they belong. */
  sync(): void {
    const comments = readComments(this.canvas);
    if (comments === this.drawn) {
      this.layout();
      return;
    }
    if (this.openId !== null && !comments.some((c) => c.id === this.openId)) this.openId = null;
    this.render();
  }

  private render(focus = false): void {
    const comments = readComments(this.canvas);
    this.drawn = comments;
    this.el.empty();
    this.placed.clear();
    for (const comment of comments) this.drawPin(comment);
    if (this.draft) this.drawDraft(this.draft);
    this.layout();
    if (focus) this.el.win.requestAnimationFrame(() => this.el.querySelector<HTMLElement>('textarea')?.focus());
  }

  /** Place each pin on screen: its canvas point mapped through the view, with the pin's tail on the point. */
  private layout(): void {
    if (this.placed.size === 0) return;
    const bbox = this.canvas.getViewportBBox?.();
    if (!bbox) return;
    if (!this.frame) {
      const wrap = this.canvas.wrapperEl.getBoundingClientRect();
      const host = this.el.getBoundingClientRect();
      this.frame = { left: wrap.left - host.left, top: wrap.top - host.top, width: wrap.width };
    }
    const { left, top, width } = this.frame;
    const zoom = width / (bbox.maxX - bbox.minX);
    if (!Number.isFinite(zoom) || zoom <= 0) return;
    for (const [pin, placement] of this.placed) {
      const at = pinPoint(this.canvas, placement);
      const x = `${(at.x - bbox.minX) * zoom + left}px`;
      const y = `${(at.y - bbox.minY) * zoom + top}px`;
      if (this.lastPlace.get(pin) === `${x} ${y}`) continue;
      this.lastPlace.set(pin, `${x} ${y}`);
      pin.setCssProps({ '--ffc-x': x, '--ffc-y': y });
    }
  }

  private pinEl(at: Placement, cls: string): { pin: HTMLElement; bubble: HTMLElement } {
    const pin = this.el.createDiv({ cls: `ffc-comment ${cls}` });
    this.placed.set(pin, at);
    const bubble = createPinBubble(pin, 'message-circle', 'ffc-comment-bubble');
    return { pin, bubble };
  }

  private drawPin(comment: CanvasComment): void {
    const open = comment.id === this.openId;
    const { pin, bubble } = this.pinEl(comment, `${open ? 'is-open' : ''} ${comment.resolved ? 'is-resolved' : ''}`);
    const toggle = (): void => {
      this.openId = open ? null : comment.id;
      this.draft = null;
      this.render(!open);
    };
    bubble.addEventListener('pointerdown', (e) => this.press(pin, comment, e, toggle));
    if (open) this.drawThread(pin, comment);
    else this.drawPreview(pin, comment).addEventListener('pointerdown', (e) => this.press(pin, comment, e, toggle));
  }

  /**
   * A press on a pin: a click opens (or closes) its thread; a drag moves the pin, attaching it to the node it is
   * let go over, or to none, as one undo step.
   */
  private press(pin: HTMLElement, comment: CanvasComment, down: PointerEvent, click: () => void): void {
    if (down.button !== 0) return;
    down.preventDefault();
    this.endDrag?.();
    const start = toCanvasPoint(this.canvas, down);
    const origin = pinPoint(this.canvas, comment);
    if (!start) return;
    let at: { x: number; y: number } | null = null;
    let target: CanvasNodeLike | undefined;
    let overTray = false;
    const mark = (node: CanvasNodeLike | undefined): void => {
      if (node === target) return;
      target?.nodeEl?.removeClass(TARGET_CLASS);
      node?.nodeEl?.addClass(TARGET_CLASS);
      target = node;
    };
    const finish = (): void => {
      stop();
      mark(undefined);
      this.endDrag = null;
    };
    // A drag that ended without a drop puts the drop zones away. A drop has already done so, and must keep which one took it.
    const abandon = (): void => {
      if (at) this.tray?.carryDrop(null);
    };
    const stop = trackPointer(this.view.containerEl.doc, down.pointerId, {
      move: (e) => {
        if (!at && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < CLICK_SLOP_PX) return;
        const p = toCanvasPoint(this.canvas, e);
        if (!p) return;
        at = { x: origin.x + p.x - start.x, y: origin.y + p.y - start.y };
        pin.addClass('is-dragging');
        // Free of its node while it's carried.
        this.placed.set(pin, at);
        // Over the tray, it would go in, not onto a node.
        overTray = this.tray?.carryOver(e) ?? false;
        mark(overTray ? undefined : nodeUnder(this.canvas, at));
        this.layout();
      },
      up: (e) => {
        const moved = at;
        const node = target;
        const toTray = moved !== null && this.tray?.carryDrop(e) === true;
        finish();
        if (!moved) click();
        else if (toTray) {
          if (this.openId === comment.id) this.openId = null;
          this.tray?.takeComment(comment);
          this.render();
        } else this.change(comment.id, (c) => movedTo(this.canvas, c, moved, node));
      },
      cancel: () => {
        finish();
        abandon();
        this.render();
      },
    });
    this.endDrag = () => {
      finish();
      abandon();
      this.render();
    };
  }

  /** What shows on hover: the first message, as a card growing out of the bubble. */
  private drawPreview(pin: HTMLElement, comment: CanvasComment): HTMLElement {
    const first = comment.thread[0];
    const card = pin.createDiv({ cls: 'ffc-comment-preview' });
    setIcon(card.createDiv({ cls: 'ffc-comment-avatar' }), 'message-circle');
    const body = card.createDiv({ cls: 'ffc-comment-body' });
    if (first) {
      this.drawHead(body, first);
      body.createDiv({ cls: 'ffc-comment-text', text: first.text });
    }
    const replies = comment.thread.length - 1;
    if (replies > 0) body.createDiv({ cls: 'ffc-comment-replies', text: replies === 1 ? '1 reply' : `${replies} replies` });
    return card;
  }

  private drawHead(parent: HTMLElement, message: CommentMessage): HTMLElement {
    const head = parent.createDiv({ cls: 'ffc-comment-head' });
    head.createSpan({ cls: 'ffc-comment-author', text: AUTHOR });
    head.createSpan({ cls: 'ffc-comment-time', text: timeAgo(message.at) });
    return head;
  }

  private drawThread(pin: HTMLElement, comment: CanvasComment): void {
    const pop = pin.createDiv({ cls: 'ffc-comment-pop' });
    const header = pop.createDiv({ cls: 'ffc-comment-header' });
    header.createSpan({ cls: 'ffc-comment-title', text: 'Comment' });
    const more = this.iconButton(header, 'ellipsis', 'More');
    more.addEventListener('click', (e) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle('Delete thread').setIcon('trash-2').onClick(() => this.remove(comment.id)));
      menu.showAtMouseEvent(e);
    });
    const resolve = this.iconButton(header, 'circle-check', comment.resolved ? 'Reopen' : 'Resolve');
    resolve.toggleClass('is-active', !!comment.resolved);
    resolve.addEventListener('click', () => {
      this.change(comment.id, (c) => ({ ...c, resolved: c.resolved ? undefined : true }));
      this.openId = null;
      this.render();
    });
    this.iconButton(header, 'x', 'Close').addEventListener('click', () => this.dismiss());

    const list = pop.createDiv({ cls: 'ffc-comment-thread' });
    for (const [i, message] of comment.thread.entries()) {
      const row = list.createDiv({ cls: 'ffc-comment-message' });
      setIcon(row.createDiv({ cls: 'ffc-comment-avatar' }), 'message-circle');
      const body = row.createDiv({ cls: 'ffc-comment-body' });
      const head = this.drawHead(body, message);
      const menu = this.iconButton(head, 'ellipsis', 'More');
      menu.addEventListener('click', (e) => {
        new Menu()
          .addItem((item) => item.setTitle('Delete comment').setIcon('trash-2').onClick(() => this.removeMessage(comment.id, i)))
          .showAtMouseEvent(e);
      });
      body.createDiv({ cls: 'ffc-comment-text', text: message.text });
    }
    const reply = pop.createDiv({ cls: 'ffc-comment-compose is-reply' });
    this.composer(reply, 'Reply', (text) => this.change(comment.id, (c) => ({ ...c, thread: [...c.thread, { text, at: Date.now() }] }), true));
  }

  private drawDraft(at: { x: number; y: number }): void {
    const { pin } = this.pinEl(at, 'is-open is-draft');
    const bar = pin.createDiv({ cls: 'ffc-comment-compose' });
    this.composer(bar, 'Add a comment', (text) => {
      const comment = movedTo(this.canvas, { id: newCommentId(), x: at.x, y: at.y, thread: [{ text, at: Date.now() }] }, at);
      this.draft = null;
      this.save((list) => [...list, comment]);
    });
  }

  /** A text box with a send button. Enter sends; Shift+Enter starts a new line. */
  private composer(parent: HTMLElement, placeholder: string, send: (text: string) => void): void {
    const input = parent.createEl('textarea', { cls: 'ffc-comment-input', attr: { placeholder, rows: '1' } });
    const button = this.iconButton(parent, 'arrow-up', 'Send');
    button.addClass('ffc-comment-send');
    const submit = (): void => {
      const text = input.value.trim();
      if (text) send(text);
    };
    const refresh = (): void => button.toggleClass('is-ready', input.value.trim().length > 0);
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', (e) => {
      // The canvas and Obsidian have keys of their own: while typing here, they're ours.
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        this.dismiss();
      }
    });
    button.addEventListener('click', submit);
  }

  private iconButton(parent: HTMLElement, icon: string, label: string): HTMLElement {
    const button = parent.createDiv({ cls: 'clickable-icon ffc-comment-action', attr: { 'aria-label': label, 'data-tooltip-position': 'top' } });
    setIcon(button, icon);
    return button;
  }

  /** Save a change to the list as one undo step, and redraw. */
  private save(fn: (comments: CanvasComment[]) => CanvasComment[]): void {
    batch(this.canvas, () => writeComments(this.canvas, fn(readComments(this.canvas))));
    this.render();
  }

  private change(id: string, fn: (comment: CanvasComment) => CanvasComment, focus = false): void {
    this.save((list) => list.map((c) => (c.id === id ? fn(c) : c)));
    if (focus) this.el.win.requestAnimationFrame(() => this.el.querySelector<HTMLElement>('textarea')?.focus());
  }

  private remove(id: string): void {
    if (this.openId === id) this.openId = null;
    this.save((list) => list.filter((c) => c.id !== id));
  }

  /** Delete one message; the last one in a thread takes the pin with it. */
  private removeMessage(id: string, index: number): void {
    const comment = readComments(this.canvas).find((c) => c.id === id);
    if (!comment) return;
    if (comment.thread.length <= 1) this.remove(id);
    else this.change(id, (c) => ({ ...c, thread: c.thread.filter((_, i) => i !== index) }));
  }
}
