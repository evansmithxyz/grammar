// Geometry checks shared by the layout tests: words must not overlap each
// other, and no line may run through a word.
import assert from 'node:assert/strict';
import { METRICS } from '../src/diagram/layout.js';

// Roughly Patrick Hand at 22px; the real app measures with a canvas.
export const measure = (text, kind) => text.length * (kind === 'small' ? 7.5 : 10);

/** Corners of a word's box (baseline up to cap height), rotated with the text. */
function box(p) {
  const w = measure(p.text, p.kind === 'label' ? 'small' : 'word');
  const h = p.kind === 'label' ? 11 : METRICS.textH;
  const a = ((p.angle || 0) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const pt = (dx, dy) => [p.x + dx * c - dy * s, p.y + dx * s + dy * c];
  return [pt(1, -1), pt(w - 1, -1), pt(w - 1, -h + 2), pt(1, -h + 2)];
}

function overlap(A, B) {
  for (const poly of [A, B]) {
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % 4];
      const nx = y2 - y1, ny = x1 - x2;
      const pa = A.map(([x, y]) => x * nx + y * ny), pb = B.map(([x, y]) => x * nx + y * ny);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

function segHitsBox(seg, B) {
  // sample along the segment; good enough at this scale
  const [x1, y1, x2, y2] = seg;
  const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2));
  for (let i = 0; i <= n; i++) {
    const x = x1 + ((x2 - x1) * i) / n, y = y1 + ((y2 - y1) * i) / n;
    // inside a convex box: on the same side of every edge, whichever way it winds
    let pos = 0, neg = 0;
    for (let k = 0; k < 4; k++) {
      const [ax, ay] = B[k], [bx, by] = B[(k + 1) % 4];
      const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      if (c > 0.5) pos++;
      else if (c < -0.5) neg++;
    }
    if (pos === 4 || neg === 4) return true;
  }
  return false;
}

const segments = (p) => (p.t === 'line' ? [[p.x1, p.y1, p.x2, p.y2]] : p.pts.slice(1).map((q, i) => [...p.pts[i], ...q]));

/** Assert a laid-out diagram is legible: finite, no overlapping words, no lines through words. */
export function assertLegible(prims) {
  for (const p of prims) {
    const nums = p.t === 'text' ? [p.x, p.y] : p.t === 'line' ? [p.x1, p.y1, p.x2, p.y2] : p.pts.flat();
    assert.ok(nums.every(Number.isFinite), `finite coordinates in ${JSON.stringify(p)}`);
  }
  // each word appears once
  const seen = new Map();
  for (const p of prims.filter((q) => q.t === 'text' && q.uid)) {
    assert.ok(!seen.has(p.uid), `“${p.text}” is drawn twice`);
    seen.set(p.uid, p);
  }
  const boxes = prims.filter((p) => p.t === 'text').map((p) => [p, box(p)]);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(!overlap(boxes[i][1], boxes[j][1]), `“${boxes[i][0].text}” overlaps “${boxes[j][0].text}”`);
    }
  }
  for (const p of prims.filter((q) => q.t !== 'text')) {
    for (const [w, B] of boxes) {
      for (const s of segments(p)) assert.ok(!segHitsBox(s, B), `a ${p.kind} line crosses “${w.text}”`);
    }
  }
}
