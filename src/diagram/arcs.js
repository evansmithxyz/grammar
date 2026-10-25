import rough from 'roughjs';
import { el } from './render.js';
import { unitFamily } from './themes.js';
import { RELATIONS } from '../model/graph.js';

/**
 * Dependency arcs: the words in sentence order with an arc from each head to
 * each word that hangs from it, labelled with the relation.
 */
export function renderArcs(svg, g, theme, measure) {
  svg.replaceChildren();
  const units = [...g.units].sort((a, b) => g.order(a) - g.order(b));
  const gap = 34;
  const xs = new Map();
  let x = 0;
  for (const u of units) {
    const w = measure(u.understood ? `(${u.text})` : g.text(u));
    xs.set(u.id, { x, w, c: x + w / 2 });
    x += w + gap;
  }
  const idx = new Map(units.map((u, k) => [u.id, k]));
  const arcs = units.filter((u) => u.head != null && xs.has(u.head)).map((u) => {
    const a = idx.get(u.head), b = idx.get(u.id);
    return { u, lo: Math.min(a, b), hi: Math.max(a, b), level: 1 };
  });
  arcs.sort((p, q) => (p.hi - p.lo) - (q.hi - q.lo));
  for (const a of arcs) {
    let lvl = 0;
    for (const b of arcs) if (b !== a && b.lo >= a.lo && b.hi <= a.hi && b.hi - b.lo < a.hi - a.lo) lvl = Math.max(lvl, b.level);
    a.level = lvl + 1;
  }
  const maxLevel = Math.max(1, ...arcs.map((a) => a.level));
  const step = 34;
  const baseY = maxLevel * step + 58;
  const W = Math.max(x - gap, 200), H = baseY + 40;
  svg.setAttribute('viewBox', `-30 -10 ${W + 60} ${H + 10}`);
  svg.setAttribute('width', W + 60);
  svg.setAttribute('height', H + 10);
  svg.dataset.w = W + 60;
  svg.dataset.h = H + 10;

  const rc = theme.rough ? rough.svg(svg) : null;
  const art = el('g', { class: 'art' }, svg);
  const lines = el('g', { class: 'lines', fill: 'none', stroke: theme.ink, 'stroke-width': theme.strokeWidth, 'stroke-linecap': 'round' }, art);
  const words = el('g', { class: 'words' }, art);
  const hitsG = el('g', { class: 'hits' }, svg);
  let order = 0;

  const stroke = (d, extra = {}) => {
    let n;
    if (rc) n = rc.path(d, { stroke: theme.ink, strokeWidth: theme.strokeWidth, roughness: theme.roughness * 0.6, bowing: 0.4, seed: order + 3, ...extra });
    else { n = el('path', { d }); }
    n.classList.add('ln');
    n.dataset.order = order++;
    lines.appendChild(n);
    return n;
  };

  for (const a of arcs) {
    const h = xs.get(a.u.head), d = xs.get(a.u.id);
    const y0 = baseY - 26;
    const top = y0 - a.level * step;
    const x1 = h.c + (d.c > h.c ? 4 : -4), x2 = d.c;
    stroke(`M ${x1} ${y0} C ${x1} ${top}, ${x2} ${top}, ${x2} ${y0 - 7}`);
    stroke(`M ${x2 - 4} ${y0 - 11} L ${x2} ${y0 - 3} L ${x2 + 4} ${y0 - 11}`);
    const label = RELATIONS[a.u.rel]?.short || a.u.rel;
    const lx = (x1 + x2) / 2, ly = top + (y0 - top) * 0.25 + 1;
    const lw = label.length * 7.6 + 10;
    el('rect', { x: lx - lw / 2, y: ly - 10, width: lw, height: 15, rx: 4, fill: 'var(--board)' }, words);
    el('text', {
      x: lx, y: ly + 1.5, 'text-anchor': 'middle', class: 'arc-label', 'font-family': 'Atkinson Hyperlegible, system-ui, sans-serif', 'font-size': 12.5,
      fill: theme.faint, 'data-order': order++,
    }, words).textContent = label;
  }
  // the root gets an arrow from above
  for (const r of units.filter((u) => u.head == null)) {
    const p = xs.get(r.id);
    const y0 = baseY - 26;
    stroke(`M ${p.c} ${y0 - maxLevel * step - 16} L ${p.c} ${y0 - 7}`, { strokeLineDash: r.rel === 'float' ? [5, 5] : undefined });
    el('text', { x: p.c, y: y0 - maxLevel * step - 22, 'text-anchor': 'middle', 'font-family': 'Atkinson Hyperlegible, system-ui, sans-serif', 'font-size': 12.5, fill: theme.faint }, words)
      .textContent = r.rel === 'root' ? 'ROOT' : 'loose';
  }
  for (const u of units) {
    const p = xs.get(u.id);
    const fam = unitFamily(g, u);
    const wrap = el('g', { class: `wg f-${fam}`, 'data-uid': u.id, 'data-order': order++ }, words);
    const t = el('text', {
      x: p.x, y: baseY, fill: theme.roles[fam], 'font-family': theme.font, 'font-size': theme.fontSize,
      'font-style': u.understood ? 'italic' : null,
    }, wrap);
    t.textContent = u.understood ? `(${u.text})` : g.text(u);
  }
  for (const wrap of words.querySelectorAll('.wg')) {
    const bb = wrap.firstChild.getBBox();
    el('rect', { x: bb.x - 5, y: bb.y - 5, width: bb.width + 10, height: bb.height + 10, rx: 6, class: 'hit', 'data-uid': wrap.dataset.uid }, hitsG);
  }
}
