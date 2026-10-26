import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render } from 'pele';
import {
  addEdge, addFirstNode, addNode, moveAmongSiblings, parentOf, reparentNode, siblingsOf, colorClassOf, edgeLabelOf, edgeStyleOf, labelOf, nodeIds, readFlowchart, removeEdge, removeNode,
  renameNode, setDirection, setEdgeLabel, setEdgeStyle, setNodeColorClass, setNodeShape, shapeOfNode,
} from '../src/canvas/flowchart-edit.ts';

const BASE = [
  'flowchart LR',
  '  A[Start] --> B{Decision}',
  '  B -->|Yes| C(Do it)',
  '  B -->|No| D([Skip it])',
  '  C --> E((Done))',
  '  D -.-> E',
  '  classDef warn fill:#f96',
  '  class C warn',
  '  linkStyle 1 stroke:red',
].join('\n');

function read(source: string) {
  const flow = readFlowchart(source);
  assert.ok(flow, `should be a flowchart:\n${source}`);
  return flow;
}

/** Whether Pele can draw `source`: every edit must leave one it can. */
function draws(source: string): void {
  assert.doesNotThrow(() => render(source), source);
}

test('reads nodes, shapes, labels and edges', () => {
  const flow = read(BASE);
  assert.deepEqual(nodeIds(flow), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(labelOf(flow, 'B'), 'Decision');
  assert.equal(shapeOfNode(flow, 'B'), 'diamond');
  assert.equal(shapeOfNode(flow, 'D'), 'stadium');
  assert.equal(shapeOfNode(flow, 'E'), 'circle');
  assert.deepEqual(flow.edges.map((e) => e.domId), ['L_A_B_0', 'L_B_C_0', 'L_B_D_0', 'L_C_E_0', 'L_D_E_0']);
  assert.equal(edgeLabelOf(flow.edges[1]), 'Yes');
  assert.equal(edgeStyleOf(flow.edges[4]), 'dotted');
  assert.equal(flow.direction, 'LR');
});

test('edge ids number repeated pairs the way Pele does', () => {
  const flow = read('flowchart TD\n  A --> B\n  A --> B\n  A --> C');
  assert.deepEqual(flow.edges.map((e) => e.domId), ['L_A_B_0', 'L_A_B_2', 'L_A_C_0']);
  const svg = render('flowchart TD\n  A --> B\n  A --> B\n  A --> C').svg;
  for (const e of flow.edges) assert.ok(svg.includes(`data-id="${e.domId}"`), e.domId);
});

test('refuses what it cannot patch safely', () => {
  assert.equal(readFlowchart('mindmap\n  root((R))'), null);
  assert.equal(readFlowchart('flowchart TD\n  A & B --> C'), null);
  assert.equal(readFlowchart('flowchart TD\n  A@{ shape: rect } --> B'), null);
});

test('reads what is around the edges: front matter, comments, semicolons, chains, subgraphs', () => {
  const flow = read('---\ntitle: T\n---\n%% note\nflowchart TD;\n  A --> B --> C;\n  subgraph one[One]\n    direction LR\n    D --> E\n  end\n  click A "https://example.com"');
  assert.deepEqual(nodeIds(flow), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(flow.edges.length, 3);
});

test('renames a node, quoting the text so any of it is safe', () => {
  const flow = read(BASE);
  const renamed = renameNode(flow, 'B', 'Is it (really) ready?');
  assert.match(renamed, /B\{"Is it \(really\) ready\?"\}/);
  draws(renamed);
  assert.equal(labelOf(read(renamed), 'B'), 'Is it (really) ready?');
  const unnamed = renameNode(read('flowchart TD\n  A --> B'), 'A', 'First');
  assert.match(unnamed, /A\["First"\] --> B/);
  draws(unnamed);
  assert.equal(renameNode(flow, 'B', '   '), BASE, 'blank text changes nothing');
  assert.equal(labelOf(read(renameNode(flow, 'A', 'a\nb')), 'A'), 'a\nb');
});

test('changes shape in every place a node is written, and gives a plain node one', () => {
  const flow = read('flowchart TD\n  A[One] --> B\n  C --> A[One]');
  const circle = setNodeShape(flow, 'A', 'circle');
  assert.equal(circle.match(/A\(\(/g)?.length, 2);
  draws(circle);
  const plain = setNodeShape(flow, 'B', 'hexagon');
  assert.match(plain, /B\{\{"B"\}\}/);
  draws(plain);
  for (const shape of ['rounded', 'stadium', 'subroutine', 'cylinder', 'asymmetric', 'parallelogram', 'trapezoid', 'double-circle'] as const) {
    const changed = setNodeShape(flow, 'B', shape);
    draws(changed);
    assert.equal(shapeOfNode(read(changed), 'B'), shape);
  }
});

test('adds a node after, before or beside another', () => {
  const flow = read(BASE);
  const after = addNode(flow, 'C', 'after');
  assert.equal(after.id, 'n1');
  assert.match(after.source, /\n {2}C --> n1\["New node"\]$/);
  draws(after.source);
  const before = addNode(flow, 'C', 'before');
  assert.match(before.source, /n1\["New node"\] --> C$/);
  draws(before.source);
  const second = addNode(read(after.source), 'C', 'branch');
  assert.equal(second.id, 'n2');
  assert.deepEqual(nodeIds(read(second.source)).slice(-2), ['n1', 'n2']);
  const first = addFirstNode(read('flowchart TD'));
  draws(first.source);
});

test('removes a node and the edges to it, keeping the nodes that were only its neighbours', () => {
  const flow = read(BASE);
  const removed = removeNode(flow, 'C');
  assert.ok(!/\bC\b/.test(removed.replace('classDef', '')), removed);
  draws(removed);
  const after = read(removed);
  assert.deepEqual(nodeIds(after), ['A', 'B', 'D', 'E']);
  // The edge that linkStyle 1 coloured (B to C) is gone, so the line goes with it, and later numbers move up.
  assert.ok(!removed.includes('linkStyle'));
  const chain = removeNode(read('flowchart TD\n  A --> B --> C'), 'B');
  draws(chain);
  assert.deepEqual(nodeIds(read(chain)), ['A', 'C']);
  const lone = removeNode(read('flowchart TD\n  A[One] --> B[Two]'), 'B');
  assert.match(lone, /A\[One\]/);
  draws(lone);
});

test('removes an edge, splits a chain, and renumbers linkStyle', () => {
  const flow = read('flowchart TD\n  A --> B --> C\n  C --> D\n  linkStyle 0,2 stroke:red');
  const removed = removeEdge(flow, 1);
  draws(removed);
  assert.equal(read(removed).edges.length, 2);
  assert.match(removed, /linkStyle 0,1 stroke:red/);
  const only = removeEdge(read('flowchart TD\n  A[One] --> B'), 0);
  assert.match(only, /A\[One\]/);
  draws(only);
});

test('edge label, style and direction', () => {
  const flow = read(BASE);
  const labelled = setEdgeLabel(flow, 0, 'go');
  assert.match(labelled, /A\[Start\] -->\|go\| B/);
  assert.equal(edgeLabelOf(read(labelled).edges[0]), 'go');
  assert.match(setEdgeLabel(flow, 1, ''), /B --> C/);
  assert.match(setEdgeLabel(flow, 1, 'Maybe'), /B -->\|Maybe\| C/);
  for (const style of ['arrow', 'line', 'dotted', 'thick'] as const) {
    const changed = setEdgeStyle(flow, 0, style);
    draws(changed);
    assert.equal(edgeStyleOf(read(changed).edges[0]), style);
  }
  assert.match(setDirection(flow, 'TD'), /^flowchart TD/);
  assert.match(setDirection(read('graph LR\n  A-->B'), 'BT'), /^graph BT/);
  assert.match(addEdge(flow, 'A', 'E', 'skip'), /A -->\|skip\| E$/);
});

test('colours are class lines that replace each other', () => {
  const flow = read(BASE);
  const red = setNodeColorClass(flow, 'A', 'ffc-c-red');
  assert.equal(colorClassOf(read(red), 'A'), 'ffc-c-red');
  const hex = setNodeColorClass(read(red), 'A', 'ffc-hex-12ab34');
  assert.equal(colorClassOf(read(hex), 'A'), 'ffc-hex-12ab34');
  assert.equal(hex.match(/class A /g)?.length, 1);
  assert.equal(colorClassOf(read(setNodeColorClass(read(hex), 'A', null)), 'A'), null);
  assert.ok(render(hex).svg.includes('ffc-hex-12ab34'));
  // The user's own class lines are left alone.
  assert.match(red, /class C warn/);
  assert.ok(!removeNode(read(red), 'A').includes('class A'));
});

/** Where Pele puts each node, by id. */
function positions(source: string): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const m of render(source).svg.matchAll(/data-id="([^"]+)" transform="translate\(([-\d.]+),([-\d.]+)\)"/g)) out[m[1]] = { x: Math.round(Number(m[2])), y: Math.round(Number(m[3])) };
  return out;
}

test('hangs a node from a different parent, keeping its arrow and label', () => {
  const flow = read('flowchart LR\n  A --> B\n  A -->|yes| C\n  B --> D');
  assert.equal(parentOf(flow, 'C'), 'A');
  const moved = reparentNode(flow, 'C', 'B');
  assert.ok(moved);
  draws(moved);
  assert.equal(parentOf(read(moved), 'C'), 'B');
  assert.match(moved, /B -->\|yes\| C/);
  assert.equal(parentOf(read(moved), 'D'), 'B');
  assert.equal(reparentNode(flow, 'C', 'A'), null, 'already its parent');
  assert.equal(reparentNode(flow, 'C', 'C'), null, 'not onto itself');
  assert.equal(reparentNode(flow, 'B', 'D'), null, 'not under its own descendant');
  assert.equal(reparentNode(flow, 'A', 'B'), null, 'a node with no edge into it is left alone');
  assert.equal(reparentNode(read('flowchart TD\n  A --> C\n  B --> C'), 'C', 'A'), null, 'two edges into it');
});

test('moving a node keeps what it was written with', () => {
  const flow = read('flowchart LR\n  A[One] --> X[Two]\n  X --> Y\n  B --> C');
  const moved = reparentNode(flow, 'X', 'B');
  assert.ok(moved);
  draws(moved);
  assert.equal(labelOf(read(moved), 'X'), 'Two');
  assert.equal(labelOf(read(moved), 'A'), 'One');
  assert.equal(parentOf(read(moved), 'X'), 'B');
});

test('reorders a node among its siblings, which moves it in the drawing', () => {
  const flow = read('flowchart LR\n  A --> B\n  A --> C\n  A --> D');
  assert.deepEqual(siblingsOf(flow, 'C'), ['B', 'D']);
  const before = positions(flow.lines.join('\n'));
  assert.ok(before.B.y < before.C.y && before.C.y < before.D.y);
  const first = moveAmongSiblings(flow, 'D', 'B', true);
  assert.ok(first);
  draws(first);
  const moved = positions(first);
  assert.ok(moved.D.y < moved.B.y && moved.B.y < moved.C.y);
  const last = moveAmongSiblings(flow, 'B', 'D', false);
  assert.ok(last);
  const end = positions(last);
  assert.ok(end.C.y < end.D.y && end.D.y < end.B.y);
  assert.equal(moveAmongSiblings(flow, 'B', 'C', true), null, 'already there');
  assert.equal(moveAmongSiblings(flow, 'B', 'A', true), null, 'not a sibling');
  assert.equal(moveAmongSiblings(flow, 'B', 'B', true), null);
});

test('reordering works with arrows that have labels, and with chains', () => {
  const flow = read('flowchart TD\n  A -->|one| B --> B2\n  A -->|two| C');
  const moved = moveAmongSiblings(flow, 'C', 'B', true);
  assert.ok(moved);
  draws(moved);
  assert.match(moved, /A -->\|two\| C/);
  const placed = positions(moved);
  assert.ok(placed.C.x < placed.B.x);
  assert.deepEqual(nodeIds(read(moved)).sort(), ['A', 'B', 'B2', 'C']);
});

test('says which line stopped a flowchart being read', () => {
  const problem = { line: 0 };
  assert.equal(readFlowchart('flowchart TD\n  A --> B\n  C & D --> E', problem), null);
  assert.equal(problem.line, 2);
  assert.equal(readFlowchart('flowchart TD\n  A -- yes --> B', problem), null);
  assert.equal(problem.line, 1);
  assert.equal(readFlowchart('mindmap\n  root', problem), null);
  assert.equal(problem.line, -1, 'not a flowchart at all');
  assert.ok(readFlowchart('flowchart TD\n  A --> B', problem));
});
