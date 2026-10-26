import { EventRef, setIcon } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasViewLike, afterCanvasFrame, shieldFromCanvas } from './adapter.ts';
import { createShowButton, loadOpen, saveOpen } from './floating-panel.ts';
import { MapTransform, Palette, drawNodes, drawViewport, fitTransform, nodeLayerKey, mapBounds, toCanvasPos } from './minimap-draw.ts';
import { trackPointer } from './pointer-session.ts';

const OPEN_KEY = 'ffc-canvas-minimap-open';
/** Set on the view while the minimap is open, so the layers panel stops short of it rather than its button. */
const OPEN_CLASS = 'ffc-minimap-open';
/** Minimap pixels kept clear around the drawing. */
const PAD_PX = 8;
/** The least time between minimap draws while the view moves. */
const DRAW_INTERVAL_MS = 50;

/**
 * A small overview of the whole canvas in the lower left, with a box for the part in view. Press or drag on it
 * to move the view there; pressing inside the box drags it from where it was held. Whether it's open is a
 * per-viewer preference, closed by default.
 */
export class Minimap {
  private el: HTMLElement;
  /** Shown instead of the minimap while it's closed. */
  private showBtn: HTMLElement;
  private mapEl: HTMLCanvasElement;
  /** Turns theme colours into ones the 2D context takes, since it can't read CSS variables. */
  private probe: HTMLElement;
  private open: boolean;
  private palette: Palette | null = null;
  /** The mapping last drawn, for turning a press into a canvas point. */
  private transform: MapTransform | null = null;
  /** Held still while dragging, so the map doesn't rescale under the pointer as the view moves. */
  private frozen: MapTransform | null = null;
  private drawTimer = 0;
  /** The nodes, drawn once and reused while only the view box moves. */
  private layer: { el: HTMLCanvasElement; key: string } | null = null;
  private lastDraw = 0;
  private endDrag: (() => void) | null = null;
  private stopFrames: () => void;
  /** Draws once the minimap is laid out, and again when it changes size. */
  private resizeObserver: ResizeObserver;
  private cssRef: EventRef;

  constructor(private plugin: CanvasPlusPlugin, private view: CanvasViewLike) {
    this.open = loadOpen(plugin.app, OPEN_KEY);
    this.el = view.contentEl.createDiv({ cls: 'ffc-minimap' });
    this.mapEl = this.el.createEl('canvas', { cls: 'ffc-minimap-map' });
    this.probe = this.el.createDiv({ cls: 'ffc-minimap-probe' });
    const hide = this.el.createEl('button', {
      cls: 'clickable-icon ffc-minimap-hide',
      attr: { 'aria-label': 'Hide minimap', 'data-tooltip-position': 'top' },
    });
    setIcon(hide, 'minimize-2');
    hide.addEventListener('click', () => this.setOpen(false));
    this.mapEl.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    shieldFromCanvas(this.el);
    this.showBtn = createShowButton(view.contentEl, 'ffc-minimap-show', 'map', 'Show minimap', () => this.setOpen(true));

    this.stopFrames = afterCanvasFrame(view.canvas!, () => this.drawSoon());
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.mapEl);
    // The theme's colours only change with the CSS, so they're read again only then.
    this.cssRef = plugin.app.workspace.on('css-change', () => {
      this.palette = null;
      this.layer = null;
      this.draw();
    });
    this.applyOpen();
  }

  private get canvas(): CanvasLike | undefined { return this.view.canvas; }

  /** The box the minimap covers in the lower-left corner, with its margin and a matching gap, so zooming to a node can keep it clear. */
  get cornerPx(): { width: number; height: number } {
    if (!this.open) return { width: 0, height: 0 };
    const margin = this.el.offsetLeft;
    return { width: margin * 2 + this.el.offsetWidth, height: margin * 2 + this.el.offsetHeight };
  }

  destroy(): void {
    this.endDrag?.();
    this.stopFrames();
    if (this.drawTimer) this.el.win.clearTimeout(this.drawTimer);
    this.resizeObserver.disconnect();
    this.plugin.app.workspace.offref(this.cssRef);
    this.view.contentEl.removeClass(OPEN_CLASS);
    this.el.remove();
    this.showBtn.remove();
  }

  private setOpen(open: boolean): void {
    this.open = open;
    saveOpen(this.plugin.app, OPEN_KEY, open);
    this.applyOpen();
  }

  private applyOpen(): void {
    this.el.toggle(this.open);
    this.showBtn.toggle(!this.open);
    this.view.contentEl.toggleClass(OPEN_CLASS, this.open);
    this.draw();
  }

  /**
   * Each colour is read from its CSS variable and checked before the probe normalises it: an invalid value
   * would leave the probe showing whatever colour it had before.
   */
  private readPalette(): Palette {
    const win = this.el.win;
    const style = win.getComputedStyle(this.el);
    const raw = (name: string): string => style.getPropertyValue(name).trim();
    const resolve = (css: string): string | null => {
      if (!css || !CSS.supports('color', css)) return null;
      this.probe.setCssStyles({ color: css });
      return win.getComputedStyle(this.probe).color;
    };
    const node = resolve(raw('--text-faint')) ?? 'gray';
    const accent = resolve(raw('--interactive-accent')) ?? node;
    const colors: Record<string, string> = {};
    for (let i = 1; i <= 6; i++) {
      // Core's are "r, g, b" triples; a theme might set a whole colour instead.
      const value = raw(`--canvas-color-${i}`);
      colors[String(i)] = resolve(`rgb(${value})`) ?? resolve(value) ?? node;
    }
    return { node, accent, colors };
  }

  /**
   * Core asks for a frame on every pan and zoom step, and a draw reads every node's data, so a big canvas
   * can't keep up. Draw at most once per interval; the last request is always honoured, so it settles right.
   */
  private drawSoon(): void {
    if (this.drawTimer) return;
    const wait = DRAW_INTERVAL_MS - (Date.now() - this.lastDraw);
    if (wait <= 0) {
      this.draw();
      return;
    }
    this.drawTimer = this.el.win.setTimeout(() => {
      this.drawTimer = 0;
      this.draw();
    }, wait);
  }

  private draw(): void {
    this.lastDraw = Date.now();
    const canvas = this.canvas;
    if (!this.open || !canvas || !this.el.isShown()) return;
    const width = this.mapEl.clientWidth;
    const height = this.mapEl.clientHeight;
    if (width === 0 || height === 0) return;
    const ratio = this.el.win.devicePixelRatio || 1;
    if (this.mapEl.width !== Math.round(width * ratio) || this.mapEl.height !== Math.round(height * ratio)) {
      this.mapEl.width = Math.round(width * ratio);
      this.mapEl.height = Math.round(height * ratio);
    }
    const ctx = this.mapEl.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const viewport = canvas.getViewportBBox?.() ?? null;
    const bounds = mapBounds(canvas, viewport);
    if (!bounds) return;
    const t = this.frozen ?? fitTransform(bounds, width, height, PAD_PX);
    this.transform = t;
    this.palette ??= this.readPalette();
    const w = this.mapEl.width;
    const h = this.mapEl.height;
    const key = `${w}x${h}|${nodeLayerKey(canvas, t)}`;
    if (this.layer?.key !== key || this.layer.el.width !== w || this.layer.el.height !== h) {
      const el = this.layer?.el ?? this.el.doc.createEl('canvas');
      el.width = w;
      el.height = h;
      const layerCtx = el.getContext('2d');
      if (!layerCtx) return;
      layerCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawNodes(layerCtx, canvas, t, this.palette);
      this.layer = { el, key };
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layer.el, 0, 0);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawViewport(ctx, t, this.palette, viewport);
  }

  private pointAt(e: PointerEvent, t: MapTransform): { x: number; y: number } {
    const rect = this.mapEl.getBoundingClientRect();
    return toCanvasPos(t, e.clientX - rect.left, e.clientY - rect.top);
  }

  private onPointerDown(e: PointerEvent): void {
    const canvas = this.canvas;
    if (e.button !== 0 || !canvas?.panTo) return;
    // Nothing drawn yet (pressed before the first frame): draw now, so the press lands where it was aimed.
    if (!this.transform) this.draw();
    const t = this.transform;
    if (!t) return;
    e.preventDefault();
    this.endDrag?.();
    const at = this.pointAt(e, t);
    const vp = canvas.getViewportBBox?.();
    const inside = !!vp && at.x >= vp.minX && at.x <= vp.maxX && at.y >= vp.minY && at.y <= vp.maxY;
    const offset = inside && vp
      ? { x: (vp.minX + vp.maxX) / 2 - at.x, y: (vp.minY + vp.maxY) / 2 - at.y }
      : { x: 0, y: 0 };
    const pan = (ev: PointerEvent): void => {
      const p = this.pointAt(ev, t);
      canvas.panTo?.(p.x + offset.x, p.y + offset.y);
    };
    this.frozen = t;
    this.mapEl.addClass('is-dragging');
    pan(e);
    const stopTracking = trackPointer(this.el.doc, e.pointerId, { move: pan, up: () => end(), cancel: () => end() });
    const end = (): void => {
      stopTracking();
      this.endDrag = null;
      this.frozen = null;
      this.mapEl.removeClass('is-dragging');
      this.draw();
    };
    this.endDrag = end;
  }
}
