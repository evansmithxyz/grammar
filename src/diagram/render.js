import rough from 'roughjs';
import { unitFamily } from './themes.js';

const NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

/** Text measurer for a theme, backed by a canvas. */
export function makeMeasurer(theme) {
  const ctx = document.createElement('canvas').getContext('2d');
  const cache = new Map();
  return (text, kind = 'word') => {
    const key = `${kind}|${text}`;
    let w = cache.get(key);
    if (w == null) {
      ctx.font = fontOf(theme, kind);
      w = ctx.measureText(text).width;
      cache.set(key, w);
    }
    return w;
  };
}

export function fontOf(theme, kind) {
  if (kind === 'small' || kind === 'label') return `${theme.italicLabels ? 'italic ' : ''}${theme.labelSize}px ${theme.labelFont}`;
  return `${theme.fontSize}px ${theme.font}`;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h) % 100000 + 1;
}

/**
 * Draw layout primitives into an <svg>.
 * opts.practice: replace words with empty slots (returns them for the quiz)
 * opts.selected / opts.dim: unit ids to emphasise / fade
 */
export function renderDiagram(svg, layout, g, theme, opts = {}) {
  const { prims, bounds } = layout;
  const margin = 30;
  const x0 = Math.floor(bounds.x0 - margin), y0 = Math.floor(bounds.y0 - margin);
  const w = Math.ceil(bounds.x1 - bounds.x0 + margin * 2), h = Math.ceil(bounds.y1 - bounds.y0 + margin * 2);
  svg.replaceChildren();
  svg.setAttribute('viewBox', `${x0} ${y0} ${w} ${h}`);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.dataset.w = w;
  svg.dataset.h = h;

  const defs = el('defs', {}, svg);
  if (theme.chalk) {
    // speckled gaps in the strokes, like chalk dragged over slate
    const f = el('filter', { id: 'chalk', x: '-2%', y: '-10%', width: '104%', height: '120%' }, defs);
    el('feTurbulence', { type: 'fractalNoise', baseFrequency: '1.1', numOctaves: '2', seed: '7', result: 'n' }, f);
    el('feColorMatrix', { in: 'n', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 1.75', result: 'mask' }, f);
    el('feComposite', { in: 'SourceGraphic', in2: 'mask', operator: 'in' }, f);
  }

  const art = el('g', { class: 'art', filter: theme.chalk ? 'url(#chalk)' : null }, svg);
  const gLines = el('g', { class: 'lines', fill: 'none', stroke: theme.ink, 'stroke-width': theme.strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, art);
  const gWords = el('g', { class: 'words' }, art);
  const gHits = el('g', { class: 'hits' }, svg);
  const rc = theme.rough ? rough.svg(svg) : null;
  const slots = [];

  prims.forEach((p, i) => {
    if (p.t === 'line' || p.t === 'poly') {
      const key = `${p.t}:${p.x1 ?? p.pts[0][0]}:${p.y1 ?? p.pts[0][1]}`;
      const faint = p.kind === 'conn' || p.kind === 'loose' || p.kind === 'stem';
      const stroke = faint ? theme.faint : theme.ink;
      let node;
      if (rc) {
        const o = {
          roughness: p.dash ? theme.roughness * 0.6 : theme.roughness,
          bowing: theme.bowing,
          stroke,
          strokeWidth: theme.strokeWidth,
          seed: hash(key),
          strokeLineDash: p.dash || p.kind === 'loose' ? [7, 6] : undefined,
          disableMultiStroke: !!p.dash,
          preserveVertices: true,
        };
        node = p.t === 'line' ? rc.line(p.x1, p.y1, p.x2, p.y2, o) : rc.linearPath(p.pts, o);
      } else {
        node = p.t === 'line'
          ? el('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 })
          : el('polyline', { points: p.pts.map((q) => q.join(',')).join(' ') });
        node.setAttribute('stroke', stroke);
        if (p.dash || p.kind === 'loose') node.setAttribute('stroke-dasharray', '6 5');
      }
      node.classList.add('ln', `k-${p.kind}`);
      if (p.dash) node.dataset.dash = '1';
      node.dataset.order = i;
      if (p.uid) node.dataset.uid = p.uid;
      gLines.appendChild(node);
      return;
    }
    // text
    const u = p.uid ? g.get(p.uid) : null;
    const fam = p.kind === 'label' ? 'conn' : u ? unitFamily(g, u) : 'mod';
    const wrap = el('g', { class: `wg f-${fam}${p.kind === 'understood' ? ' understood' : ''}`, 'data-order': i }, gWords);
    if (p.uid) wrap.dataset.uid = p.uid;
    const small = p.kind === 'label';
    const t = el('text', {
      x: p.x, y: p.y,
      transform: p.angle ? `rotate(${round(p.angle)} ${round(p.x)} ${round(p.y)})` : null,
      fill: theme.roles[fam] || theme.ink,
      'font-family': small ? theme.labelFont : theme.font,
      'font-size': small ? theme.labelSize : theme.fontSize,
      'font-style': (small && theme.italicLabels) || p.kind === 'understood' ? 'italic' : null,
      opacity: p.kind === 'understood' ? 0.75 : null,
    }, wrap);
    t.textContent = p.text;
    if (opts.practice && p.uid && p.kind !== 'label') {
      t.setAttribute('visibility', 'hidden');
      slots.push({ uid: p.uid, text: p.text, wrap, textEl: t, prim: p });
    }
  });

  // hit areas: the word, and for a word on a flat line the whole stretch of
  // line under it, so dropping onto "the word's line" counts too
  const anchors = layout.anchors || {};
  for (const wrap of gWords.querySelectorAll('.wg[data-uid]')) {
    const t = wrap.firstChild;
    const bb = t.getBBox();
    const pad = 5;
    let x0 = bb.x - pad, x1 = bb.x + bb.width + pad, y0 = bb.y - pad, y1 = bb.y + bb.height + pad;
    const a = anchors[wrap.dataset.uid];
    if (a && !a.slant && !t.getAttribute('transform') && Math.abs(a.y - (bb.y + bb.height)) < 40) {
      x0 = Math.min(x0, a.x0 + 2);
      x1 = Math.max(x1, a.x1 - 2);
      y1 = Math.max(y1, a.y + 5);
    }
    el('rect', {
      x: x0, y: y0, width: x1 - x0, height: y1 - y0,
      transform: t.getAttribute('transform'), class: 'hit', 'data-uid': wrap.dataset.uid, rx: 6,
    }, gHits);
  }
  // empty subject slots take a dropped word (build-from-scratch mode)
  if (opts.zones) {
    const h = theme.fontSize * 1.4;
    for (const [key, a] of Object.entries(anchors)) {
      if (!key.startsWith('subjslot:')) continue;
      el('rect', {
        x: a.x0 + 4, y: a.y - h - 2, width: Math.max(24, a.x1 - a.x0 - 8), height: h + 6, rx: 6,
        class: 'zone', 'data-zone': 'subj', 'data-verb': key.slice('subjslot:'.length),
      }, gHits);
    }
  }
  for (const s of slots) {
    // a slim box sitting on the line where the word goes, centred on the word
    // and never wider than needed, so it stays inside its stretch of line
    const bb = s.textEl.getBBox();
    const slanted = !!s.textEl.getAttribute('transform');
    const hgt = theme.fontSize * (slanted ? 0.74 : 0.86);
    const w = Math.max(bb.width + (slanted ? 4 : 8), 22);
    s.rect = el('rect', {
      x: bb.x + bb.width / 2 - w / 2, y: s.prim.y - hgt + 1, width: w, height: hgt,
      transform: s.textEl.getAttribute('transform'), class: 'slot', 'data-slot': s.uid, rx: 4,
    }, gHits);
  }
  return { slots, w, h };
}

const round = (n) => Math.round(n * 10) / 10;

/** Pen-stroke draw-on animation, in layout order. `only`: just these units' lines and words. */
export function animateDraw(svg, { stagger = 16, duration = 380, words = true, only = null } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const items = [...svg.querySelectorAll('.lines .ln, .words .wg')]
    .filter((n) => !only || only.has(n.dataset.uid))
    .sort((a, b) => a.dataset.order - b.dataset.order);
  let k = 0;
  for (const node of items) {
    if (node.classList.contains('wg')) {
      if (words) node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: k * stagger + 120, fill: 'backwards', easing: 'ease-out' });
      continue;
    }
    const delay = k++ * stagger;
    const paths = node.tagName === 'g' ? [...node.querySelectorAll('path')] : [node];
    for (const p of paths) {
      if (node.dataset.dash || !p.getTotalLength) {
        p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay, fill: 'backwards' });
        continue;
      }
      const len = Math.ceil(p.getTotalLength()) + 1;
      p.style.strokeDasharray = `${len} ${len}`;
      p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
        duration, delay, fill: 'backwards', easing: 'cubic-bezier(.3,.6,.3,1)',
      }).finished.then(() => { p.style.strokeDasharray = ''; }, () => {});
    }
  }
  return k * stagger + duration;
}
