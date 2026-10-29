import { setIcon } from 'obsidian';
import { CanvasLike, CanvasNodeLike, afterCanvasFrame } from './adapter.ts';

/** The custom property, on the canvas, that holds how many canvas units one screen pixel is. */
const SCALE_VAR = '--ffc-pin-scale';
/** The custom property, on the canvas, that holds the layer pinned nodes sit on. */
const LAYER_VAR = '--ffc-pin-z';
/** Set on core's handles while they are for a pinned node. */
const HANDLES_CLASS = 'ffc-for-pin';

/**
 * The bubble that comment pins and pinned nodes share: a round pin with a tail at its bottom-left and an icon in it.
 * Its look and its size, which stays the same on screen at any zoom, come from `.ffc-pin-bubble`.
 */
export function createPinBubble(parent: HTMLElement, icon: string, cls: string): HTMLElement {
  const bubble = parent.createDiv({ cls: `ffc-pin-bubble ${cls}` });
  setIcon(bubble, icon);
  return bubble;
}

/**
 * Keep the canvas's pin scale up to date as the view zooms, and core's handles off a pinned node: a pin that sits inside the canvas is scaled with it,
 * and multiplying its size by this puts it back to its size on screen. Returns a function that stops it.
 */
export function watchPinScale(canvas: CanvasLike): () => void {
  const wrapper = canvas.wrapperEl;
  let width = wrapper.clientWidth;
  let last = '';
  let lastLayer = '';
  // Reading the width forces a layout, so it's kept until a resize.
  const resizes = new ResizeObserver(() => { width = wrapper.clientWidth; });
  resizes.observe(wrapper);
  // Core's handles belong to the canvas, not the node, so a pin's are hidden by marking them while it is their target.
  // They also follow the pointer over a node's edge, which isn't a canvas frame, so the move is caught where it is made.
  const layer = canvas.nodeInteractionLayer;
  const markHandles = (): void => {
    // The node's element is marked when it is dressed as a pin: cheaper than reading its data, which copies it, on every frame.
    layer?.interactionEl.toggleClass(HANDLES_CLASS, !!layer.target?.nodeEl?.hasAttribute('data-ffc-pin'));
  };
  const setTarget = layer?.setTarget;
  const ownSetTarget = !!layer && Object.prototype.hasOwnProperty.call(layer, 'setTarget');
  const wrapped = function (this: unknown, node: CanvasNodeLike | null): void {
    setTarget?.call(this, node);
    markHandles();
  };
  if (layer && setTarget) layer.setTarget = wrapped;
  const update = (): void => {
    markHandles();
    // Pinned nodes stay above the rest: core gives a node a layer above all before it each time it is selected, so theirs follows.
    const layer = String((canvas.zIndexCounter ?? 0) + 1);
    if (layer !== lastLayer) {
      lastLayer = layer;
      wrapper.setCssProps({ [LAYER_VAR]: layer });
    }
    const bbox = canvas.getViewportBBox?.();
    if (!bbox || width <= 0) return;
    const scale = (bbox.maxX - bbox.minX) / width;
    if (!Number.isFinite(scale) || scale <= 0) return;
    const value = scale.toFixed(4);
    if (value === last) return;
    last = value;
    wrapper.setCssProps({ [SCALE_VAR]: value });
  };
  update();
  const stop = afterCanvasFrame(canvas, update);
  return () => {
    stop();
    resizes.disconnect();
    wrapper.setCssProps({ [SCALE_VAR]: '', [LAYER_VAR]: '' });
    // If something else has wrapped it since, ours stays in the chain but does nothing more than mark the handles.
    if (layer && setTarget && layer.setTarget === wrapped) {
      if (ownSetTarget) layer.setTarget = setTarget;
      else Reflect.deleteProperty(layer, 'setTarget');
    }
    layer?.interactionEl.removeClass(HANDLES_CLASS);
  };
}
