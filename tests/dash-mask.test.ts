import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dashMask } from '../src/canvas/dash-mask.ts';

const svgOf = (mask: string): string => decodeURIComponent(mask.slice('url("data:image/svg+xml,'.length, -2));
const dashes = (svg: string): Array<{ dash: number; gap: number; length: number }> =>
  [...svg.matchAll(/stroke-dasharray='([\d.]+) ([\d.]+)'/g)].map((m) => ({ dash: Number(m[1]), gap: Number(m[2]), length: 0 }));

test('a dashed outline is four sides, each with whole dashes and gaps near the aim', () => {
  const sides = dashes(svgOf(dashMask(260, 120, 8)));
  assert.equal(sides.length, 4);
  for (const { dash, gap } of sides) {
    assert.ok(dash > 6 && dash < 10, `dash ${dash}`);
    assert.ok(gap > 4 && gap < 8, `gap ${gap}`);
  }
});

test('opposite sides get the same spacing, so the line closes evenly', () => {
  const [top, right, bottom, left] = dashes(svgOf(dashMask(300, 140, 8)));
  assert.deepEqual(top, bottom);
  assert.deepEqual(left, right);
});

test('a card smaller than its corners still makes a valid outline', () => {
  const svg = svgOf(dashMask(10, 6, 8));
  assert.ok(!svg.includes('NaN') && !/[ A-Z]-\d/.test(svg), svg);
});
