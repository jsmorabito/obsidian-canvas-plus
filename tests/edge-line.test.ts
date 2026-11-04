import test from 'node:test';
import assert from 'node:assert/strict';
import { joinSegments, lineOf } from '../src/canvas/edge-line-data.ts';
import type { CanvasEdgeLike } from '../src/canvas/adapter.ts';

test('joins the stub and curve into one line', () => {
  assert.equal(joinSegments('M10 20 L10 40 M10,40 C1,2 3,4 5,6'), 'M10 20 L10 40 L10,40 C1,2 3,4 5,6');
  assert.equal(joinSegments('M10,40 C1,2 3,4 5,6 M5 6 L9 9'), 'M10,40 C1,2 3,4 5,6 L5 6 L9 9');
});

test('leaves a line with no stubs alone', () => {
  assert.equal(joinSegments('M1,2 C3,4 5,6 7,8'), 'M1,2 C3,4 5,6 7,8');
});

test('an edge is solid unless saved as dashed', () => {
  const edge = (unknownData: Record<string, unknown>): CanvasEdgeLike => ({ unknownData }) as unknown as CanvasEdgeLike;
  assert.equal(lineOf(edge({})), 'solid');
  assert.equal(lineOf(edge({ ffcEdgeLine: 'dashed' })), 'dashed');
  assert.equal(lineOf(edge({ ffcEdgeLine: 'wavy' })), 'solid');
});
