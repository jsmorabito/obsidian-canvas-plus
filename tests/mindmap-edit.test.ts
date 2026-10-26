import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from 'pele';
import {
  addChild, addSibling, colorOf, duplicateNode, labelOf, moveNode, outlineOf, parseOutline, pasteOutline, readMindmap, relocate,
  remove, rename, setBranchColor, setColor, setNodeIcon, setShape, shapeOf, toggleLabelFormat,
} from '../src/canvas/mindmap-edit.ts';
import { TEXT_FORMATS, toggleFormat } from '../src/canvas/mindmap-format.ts';

const BASE = 'mindmap\n  root((R))\n    A\n      A1\n      ::icon(lucide-book)\n    B[Boxed]\n      B1\n    C';

/** The source parsed, failing the test when it can't be. */
function read(source: string) {
  const map = readMindmap(source);
  assert.ok(map, `should be a mindmap:\n${source}`);
  return map;
}

/** Whether Pele can draw `source`: every edit must leave one it can. */
function draws(source: string): void {
  assert.doesNotThrow(() => render(source), source);
}

const format = (id: string) => {
  const found = TEXT_FORMATS.find((f) => f.id === id);
  assert.ok(found);
  return found;
};

test('reads a mindmap into nodes with the lines under each', () => {
  const map = read(BASE);
  assert.deepEqual(map.items.map((i) => i.nodeId), ['root', 'A', 'A1', 'B', 'B1', 'C']);
  // A's block includes the icon line that decorates A1.
  assert.equal(map.items[1].end, 4);
  assert.equal(map.items[2].parent, 1);
  assert.equal(map.items[0].parent, -1);
});

test('refuses what it cannot edit', () => {
  assert.equal(readMindmap('flowchart LR\n  A --> B'), null);
  assert.equal(readMindmap('mindmap\n  root((R))\n    x\n    x'), null, 'two nodes with one name');
  assert.equal(readMindmap('mindmap\n  a\n  b'), null, 'two roots');
});

test('adds children and siblings with names of their own', () => {
  const map = read(BASE);
  const child = addChild(map, 1);
  draws(child.source);
  assert.equal(labelOf(read(child.source), child.index), 'New idea');
  const sibling = addSibling(read(child.source), 1);
  assert.equal(labelOf(read(sibling.source), sibling.index), 'New idea 2');
  const above = addSibling(map, 3, true);
  assert.equal(read(above.source).items[above.index].parent, 0);
});

test('renames keep the shape, and strip brackets that would change it', () => {
  const map = read(BASE);
  const boxed = rename(map, 3, 'Big (box)');
  assert.match(boxed, /B\[Big box\]/);
  draws(boxed);
  assert.equal(rename(map, 1, '   '), BASE, 'blank text changes nothing');
});

test('removes a node with everything under it, but not the root', () => {
  const map = read(BASE);
  const removed = remove(map, 1);
  assert.ok(removed);
  assert.ok(!removed.source.includes('A1'));
  assert.equal(remove(map, 0), null);
});

test('moves, indents and outdents', () => {
  const map = read(BASE);
  assert.equal(relocate(map, 1, 'up'), null);
  const down = relocate(map, 1, 'down');
  assert.ok(down);
  draws(down.source);
  assert.deepEqual(read(down.source).items.map((i) => i.nodeId).slice(1, 4), ['B', 'B1', 'A']);
  const indent = relocate(map, 3, 'indent');
  assert.ok(indent);
  assert.equal(read(indent.source).items[indent.index].parent, 1);
  const outdent = relocate(map, 2, 'outdent');
  assert.ok(outdent);
  assert.equal(read(outdent.source).items[outdent.index].parent, 0);
  assert.equal(relocate(map, 3, 'outdent'), null, 'a child of the root has nowhere to go out to');
  assert.equal(moveNode(map, 1, 2, 'inside'), null, 'not into its own child');
});

test('colours: a preset, a custom colour, and the classes beside them', () => {
  const map = read(`${BASE}\n      :::keep`);
  const red = setColor(map, 1, 'red');
  assert.equal(colorOf(read(red), 1), 'red');
  const custom = setColor(read(red), 1, '#12AB34');
  assert.equal(colorOf(read(custom), 1), '#12ab34');
  assert.ok(!custom.includes('ffc-c-red'));
  assert.equal(setColor(read(custom), 1, '#zzz'), custom, 'a bad colour changes nothing');
  assert.ok(!setColor(read(custom), 1, null).includes('ffc-hex'));
  const branch = setBranchColor(BASE, 1, 'purple');
  assert.equal(colorOf(read(branch), 2), 'purple');
  draws(branch);
});

test('shapes round trip, and a plain node gets an id to carry one', () => {
  const map = read(BASE);
  const hex = setShape(map, 1, 'hexagon');
  assert.equal(shapeOf(read(hex), 1), 'hexagon');
  draws(hex);
  assert.equal(shapeOf(read(setShape(read(hex), 1, 'text')), 1), 'text');
  assert.equal(shapeOf(map, 3), 'square');
});

test('icons are written as a decoration line and nothing that could break it', () => {
  const map = read(BASE);
  assert.match(setNodeIcon(map, 3, 'lucide-star'), /::icon\(lucide-star\)/);
  assert.equal(setNodeIcon(map, 3, 'a)b'), BASE);
});

test('wikilinks are stored as plain text and edited as [[links]]', () => {
  const map = read(BASE);
  const linked = toggleLabelFormat(map, 1, format('wikilink'));
  assert.match(linked, /\n {4}⟦A⟧/);
  draws(linked);
  assert.equal(labelOf(read(linked), 1), '[[A]]');
  const text = rename(map, 1, 'See [[Some note|an alias]] now');
  assert.equal(labelOf(read(text), 1), 'See [[Some note|an alias]] now');
  draws(text);
  assert.ok(!toggleLabelFormat(read(linked), 1, format('wikilink')).includes('⟦'));
});

test('text formats toggle on and off, and italic is not bold', () => {
  assert.equal(toggleFormat('hello', 0, 5, format('bold')).value, '**hello**');
  assert.equal(toggleFormat('**hello**', 2, 7, format('bold')).value, 'hello');
  assert.equal(toggleFormat('**hello**', 2, 7, format('italic')).value, '***hello***');
  assert.equal(toggleFormat('*hello*', 1, 6, format('italic')).value, 'hello');
});

test('outlines: copied out, read in, and pasted under a node', () => {
  const map = read(BASE);
  assert.equal(outlineOf(map, 3), '- Boxed\n\t- B1');
  assert.deepEqual(parseOutline('- one\n\t- two\n\t\t- deep\n1. three\n- [ ] four'), [
    { depth: 0, text: 'one' }, { depth: 1, text: 'two' }, { depth: 2, text: 'deep' }, { depth: 0, text: 'three' }, { depth: 0, text: 'four' },
  ]);
  const pasted = pasteOutline(map, 1, parseOutline('- one\n\t- two\n- A'));
  assert.ok(pasted);
  draws(pasted.source);
  assert.equal(labelOf(read(pasted.source), pasted.index), 'one');
  assert.ok(pasted.source.includes('A 2'), 'a name that is taken gets a number');
});

test('duplicates a node with a different name for each copy', () => {
  const map = read(BASE);
  const copy = duplicateNode(map, 3);
  assert.ok(copy);
  draws(copy.source);
  assert.deepEqual(read(copy.source).items.map((i) => i.nodeId).slice(3, 6), ['B', 'B1', 'B2']);
  assert.equal(duplicateNode(map, 0), null);
  const twice = duplicateNode(read(copy.source), 3);
  assert.ok(twice);
  draws(twice.source);
});
