import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CanvasNodeLike } from '../src/canvas/adapter.ts';
import { DiagramHeld, diagramFields, keepHeld, readDiagram } from '../src/canvas/diagram-data.ts';
import type { TrayItem } from '../src/canvas/tray-items.ts';

const item = (id: string): TrayItem => ({ id, nodes: [{ id, type: 'text', x: 0, y: 0, width: 10, height: 10 }], edges: [] }) as unknown as TrayItem;
const held: DiagramHeld = { c1: item('a'), c2: item('b') };

test('a held card stays while the node that stands for it is in the source', () => {
  const source = 'kanban\n  todo[Todo]\n    c1["[[Note]]"]@{ ticket: "x" }\n    c2["two"]';
  assert.deepEqual(Object.keys(keepHeld(source, held) ?? {}), ['c1', 'c2']);
});

test('it goes when its node does, and nothing is kept when none is left', () => {
  assert.deepEqual(Object.keys(keepHeld('kanban\n  todo[Todo]\n    c2["two"]', held) ?? {}), ['c2']);
  assert.equal(keepHeld('kanban\n  todo[Todo]', held), undefined);
  assert.equal(keepHeld('kanban', undefined), undefined);
});

test('an id is matched whole: c1 is not c11, nor text that ends in c1[', () => {
  assert.equal(keepHeld('kanban\n  todo[Todo]\n    c11["x"]\n    abc1["y"]', { c1: item('a') }), undefined);
});

test('an id with characters a pattern would read is matched as written', () => {
  assert.deepEqual(Object.keys(keepHeld('kanban\n  todo[Todo]\n    a.b["x"]', { 'a.b': item('a') }) ?? {}), ['a.b']);
  assert.equal(keepHeld('kanban\n  todo[Todo]\n    axb["x"]', { 'a.b': item('a') }), undefined);
});

test('held cards are saved with the diagram and read back', () => {
  const fields = diagramFields('kanban\n  t[T]\n    c1["x"]', undefined, { c1: item('a') });
  const node = { unknownData: fields } as unknown as CanvasNodeLike;
  assert.deepEqual(Object.keys(readDiagram(node, fields)?.held ?? {}), ['c1']);
});

test('a held card that a canvas file has malformed is left out', () => {
  const bad = { source: 'kanban\n  t[T]', held: { a: { id: 'x', nodes: [null], edges: [] }, b: { id: 'y', nodes: [{}], edges: [3] }, c: item('ok') } };
  const node = {} as CanvasNodeLike;
  assert.deepEqual(Object.keys(readDiagram(node, { ffcDiagram: bad } as never)?.held ?? {}), ['c']);
});
