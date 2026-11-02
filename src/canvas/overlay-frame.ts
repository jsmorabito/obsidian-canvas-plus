import type { CanvasLike } from './adapter.ts';

/** Canvas units to the screen of an overlay layer: where the view's corner sits in the layer, and pixels per unit. */
export interface Projection {
  left: number;
  top: number;
  minX: number;
  minY: number;
  zoom: number;
}

/**
 * Maps canvas points into a layer laid over the canvas. Where the canvas sits in the layer is kept until either
 * resizes, as reading it forces a layout.
 */
export class OverlayFrame {
  private frame: { left: number; top: number; width: number } | null = null;
  private resizes: ResizeObserver;

  constructor(private canvas: CanvasLike, private host: HTMLElement) {
    this.resizes = new ResizeObserver(() => { this.frame = null; });
    this.resizes.observe(canvas.wrapperEl);
    this.resizes.observe(host);
  }

  destroy(): void {
    this.resizes.disconnect();
  }

  /** Null until the canvas has a view. */
  project(): Projection | null {
    const bbox = this.canvas.getViewportBBox?.();
    if (!bbox) return null;
    if (!this.frame) {
      const wrap = this.canvas.wrapperEl.getBoundingClientRect();
      const host = this.host.getBoundingClientRect();
      this.frame = { left: wrap.left - host.left, top: wrap.top - host.top, width: wrap.width };
    }
    const zoom = this.frame.width / (bbox.maxX - bbox.minX);
    if (!Number.isFinite(zoom) || zoom <= 0) return null;
    return { left: this.frame.left, top: this.frame.top, minX: bbox.minX, minY: bbox.minY, zoom };
  }
}
