import { DG_NODE_ICON, LINEAR_ICON, NOTE_TYPES_ICON, TASKAPP_ICON } from './icons.ts';

export type ToolId = 'select' | 'text' | 'card' | 'group' | 'anchor' | 'comment' | 'marker' | 'highlighter' | 'eraser';

export type PlaceTool = 'text' | 'card' | 'group' | 'anchor';

export interface ToolDef {
  id: ToolId;
  label: string;
  icon: string;
  /** Single-key shortcut, lower case. */
  key: string;
  /** Needs Shift held (the highlighter is Shift+M). */
  shift?: boolean;
}

/** The tools and their shortcuts. The bottom menu decides which of them get a button. */
export const TOOLS: readonly ToolDef[] = [
  { id: 'select',      label: 'Select',      icon: 'mouse-pointer-2', key: 'v' },
  { id: 'text',        label: 'Text',        icon: 'type',            key: 't' },
  { id: 'card',        label: 'Card',        icon: 'sticky-note',     key: 'c' },
  { id: 'group',       label: 'Group',       icon: 'frame',           key: 'g' },
  { id: 'anchor',      label: 'Anchor',      icon: 'anchor',          key: 'a' },
  { id: 'comment',     label: 'Comment',     icon: 'message-circle',  key: 'k' },
  { id: 'marker',      label: 'Marker',      icon: 'pencil',          key: 'm' },
  { id: 'highlighter', label: 'Highlighter', icon: 'highlighter',     key: 'm', shift: true },
  { id: 'eraser',      label: 'Eraser',      icon: 'eraser',          key: 'e' },
];

export function toolForKey(key: string, shift: boolean): ToolDef | undefined {
  return TOOLS.find((t) => t.key === key && !!t.shift === shift);
}

/** Tools that place a node by clicking or dragging on the canvas. */
export function isPlacementTool(tool: ToolId): tool is PlaceTool {
  return tool === 'text' || tool === 'card' || tool === 'group' || tool === 'anchor';
}

/** Freehand tools, which capture drags on the canvas and stay active until another tool is picked. */
export function isInkTool(tool: ToolId): tool is 'marker' | 'highlighter' | 'eraser' {
  return tool === 'marker' || tool === 'highlighter' || tool === 'eraser';
}

/** Tools that draw with a colour. */
export function isPenTool(tool: ToolId): tool is 'marker' | 'highlighter' {
  return tool === 'marker' || tool === 'highlighter';
}

export type ActionId = 'picker' | 'linear' | 'taskapp' | 'dgnode' | 'diagram' | 'actions';

export interface ActionDef {
  id: ActionId;
  label: string;
  icon: string;
  key: string;
}

/** One-shot actions (they don't change the active tool). */
export const ACTIONS: readonly ActionDef[] = [
  { id: 'picker', label: 'Add note', icon: NOTE_TYPES_ICON, key: 'n' },
  { id: 'linear', label: 'Add Linear issue', icon: LINEAR_ICON, key: 'i' },
  { id: 'taskapp', label: 'Add Task App issue', icon: TASKAPP_ICON, key: 'j' },
  { id: 'dgnode', label: 'Create discourse node', icon: DG_NODE_ICON, key: 'd' },
  { id: 'diagram', label: 'Add diagram', icon: 'workflow', key: 'b' },
];

export function actionForKey(key: string): ActionDef | undefined {
  return ACTIONS.find((a) => a.key === key);
}
