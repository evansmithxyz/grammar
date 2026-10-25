import rough from 'roughjs';
import { unitFamily } from '../diagram/themes.js';

const NS = 'http://www.w3.org/2000/svg';
// room (px) beside a word for its marks: a parenthesis is drawn 8px wide just
// off the word, further ones step out by 5, and a circle overhangs by about 4
const PAREN = 9, PAREN_STEP = 5, CIRCLE = 4;

/**
 * The typed sentence, re-rendered with each word coloured by its role and
 * marked up the way a teacher would on paper: subject underlined once, verb
 * twice, objects circled, complements boxed.
 */
export class Strip {
  constructor(root, { onHover, onSelect }) {
    this.root = root;
    this.onHover = onHover;
    this.onSelect = onSelect;
    root.addEventListener('pointerover', (e) => {
      const t = e.target.closest('.tok');
      this.onHover(t ? t.dataset.uid : null);
    });
    root.addEventListener('pointerleave', () => this.onHover(null));
    root.addEventListener('click', (e) => {
      const t = e.target.closest('.tok');
      if (t) this.onSelect(t.dataset.uid, (t.dataset.uids || '').split(' ').filter(Boolean));
    });
    new ResizeObserver(() => this.drawMarks()).observe(root);
  }

  /**
   * plain: no colours or marks (and no clicking). shown: only these units are
   * coloured and marked; the rest stay plain but clickable (guided mode).
   */
  render(text, g, theme, { plain = false, shown = null } = {}) {
    this.g = g;
    this.theme = theme;
    this.plain = plain;
    const root = this.root;
    root.replaceChildren();
    if (!g || !g.tokens.length) {
      const e = document.createElement('span');
      e.className = 'empty';
      e.textContent = 'Your sentence will appear here, marked up.';
      root.append(e);
      return;
    }
    const unitOf = new Map();
    for (const u of g.units) for (const i of u.tokens) unitOf.set(i, u);
    let pos = 0;
    let lastSpan = null;
    // punctuation right after a word gets its own span, so a closing
    // parenthesis can go after "Office," instead of over the comma
    const gap = (str) => {
      const m = /^[^\s\w]+/.exec(str);
      if (m && lastSpan) {
        const p = document.createElement('span');
        p.className = 'punct';
        p.textContent = m[0];
        root.append(p);
        str = str.slice(m[0].length);
      }
      if (str) root.append(document.createTextNode(str));
    };
    for (const t of g.tokens) {
      const u = unitOf.get(t.i);
      if (t.end <= t.start) {
        // second half of a contraction: share the previous word's span
        if (lastSpan && u) lastSpan.dataset.uids += ` ${u.id}`;
        continue;
      }
      if (t.start > pos) gap(text.slice(pos, t.start));
      const s = document.createElement('span');
      s.className = 'tok';
      s.textContent = text.slice(t.start, t.end);
      if (u && !plain) {
        s.dataset.uid = u.id;
        s.dataset.uids = u.id;
        if (!shown || shown.has(u.id)) {
          s.classList.add(`f-${unitFamily(g, u)}`);
          if (u.rel === 'float') s.classList.add('float');
          const mark = this.markOf(u);
          if (mark) s.dataset.mark = mark;
        }
      }
      root.append(s);
      lastSpan = s;
      pos = Math.max(pos, t.end);
    }
    if (pos < text.length) gap(text.slice(pos));
    this.parens = plain ? [] : this.phrases();
    this.makeRoom();
    this.drawMarks();
  }

  /** How a unit is marked: underline, double underline, circle or box. */
  markOf(u) {
    const g = this.g;
    // follow compound parts back to the role they share
    let c = u;
    for (let n = 0; n < 20 && c && c.rel === 'conj'; n++) c = g.head(c);
    const r0 = c ? c.rel : null;
    // a clause's verb is underlined twice even when the clause is a subject ("What he SAID surprised me")
    if (unitFamily(g, u) === 'verb' && (u.rel === 'root' || u.rel === 'conj' || u.rel === 'advcl' || u.rel === 'relcl' || g.kid(u, 'subj'))) return 'double';
    if (r0 === 'subj') return 'under';
    if (r0 === 'dobj' || r0 === 'iobj') return 'circle';
    if (r0 === 'pred' || r0 === 'ocomp') return 'box';
    return null;
  }

  /** The span each prepositional phrase opens at and the one it closes after. */
  phrases() {
    const g = this.g;
    // a unit can span several words ("United States"): phrases open at its
    // first word and close after its last
    const firstSpan = new Map(), lastSpan = new Map();
    for (const s of this.root.querySelectorAll('.tok[data-uids]')) {
      for (const id of s.dataset.uids.split(' ')) {
        if (!firstSpan.has(id)) firstSpan.set(id, s);
        lastSpan.set(id, s);
      }
    }
    const out = [];
    for (const p of g.units.filter((u) => u.rel === 'prep' && g.kid(u, 'pobj'))) {
      const ids = [];
      const walk = (u) => { ids.push(u); for (const k of g.kids(u)) walk(k); };
      walk(p);
      const ordered = ids.filter((u) => firstSpan.has(u.id)).sort((a, b) => g.order(a) - g.order(b));
      if (!ordered.length) continue;
      const firstEl = firstSpan.get(ordered[0].id);
      let lastEl = ordered.map((u) => lastSpan.get(u.id))
        .reduce((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? b : a));
      if (lastEl.nextSibling?.classList?.contains('punct')) lastEl = lastEl.nextSibling;
      out.push({ firstEl, lastEl });
    }
    return out;
  }

  /**
   * Widen the gaps that hold marks, so a ")" and the next "(" (or a circle
   * and a parenthesis) don't squeeze into one ordinary word gap.
   */
  makeRoom() {
    const room = new Map();
    const add = (el, side, px) => {
      const r = room.get(el) || [0, 0];
      r[side] += px;
      room.set(el, r);
    };
    for (const s of this.root.querySelectorAll('.tok[data-mark="circle"]')) { add(s, 0, CIRCLE); add(s, 1, CIRCLE); }
    // the first parenthesis on a side takes its own width, each further one a step
    const seen = new Set();
    for (const { firstEl, lastEl } of this.parens) {
      for (const [el, side] of [[firstEl, 0], [lastEl, 1]]) {
        const key = `${side}:${[...this.root.children].indexOf(el)}`;
        add(el, side, seen.has(key) ? PAREN_STEP : PAREN);
        seen.add(key);
      }
    }
    for (const [el, [l, r]] of room) {
      if (l) el.style.marginLeft = `${l}px`;
      if (r) el.style.marginRight = `${r}px`;
    }
  }

  drawMarks() {
    const g = this.g;
    if (!g) return;
    this.root.querySelector('svg.marks')?.remove();
    const svg = document.createElementNS(NS, 'svg');
    svg.classList.add('marks');
    const box = this.root.getBoundingClientRect();
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', box.height);
    const rc = rough.svg(svg);
    const css = getComputedStyle(document.documentElement);
    const color = (fam) => css.getPropertyValue(`--c-${fam}`).trim() || 'currentColor';
    let seed = 1;
    for (const s of this.root.querySelectorAll('.tok[data-mark]')) {
      const u = g.get(s.dataset.uid);
      if (!u) continue;
      const mark = s.dataset.mark;
      const opts = { stroke: color(unitFamily(g, u)), strokeWidth: 1.6, roughness: 1.3, bowing: 1.2, seed: seed++ };
      for (const r of s.getClientRects()) {
        const x = r.left - box.left, y = r.top - box.top, w = r.width, h = r.height;
        const base = y + h * 0.78;
        let node = null;
        if (mark === 'under') node = rc.line(x, base, x + w, base + 1, opts);
        else if (mark === 'double') {
          node = document.createElementNS(NS, 'g');
          node.append(rc.line(x, base - 1, x + w, base, opts), rc.line(x + 2, base + 4, x + w - 1, base + 5, { ...opts, seed: seed++ }));
        } else if (mark === 'circle') node = rc.ellipse(x + w / 2, y + h * 0.52, w + 9, h * 0.62, opts);
        else if (mark === 'box') node = rc.rectangle(x - 2, y + h * 0.2, w + 4, h * 0.62, opts);
        if (node) svg.append(node);
      }
    }
    // prepositional phrases go in parentheses; when two phrases start or end
    // at the same word, each further mark steps outward (and clear of a circle)
    const used = new Map();
    const step = (el, side) => {
      const key = `${side}:${[...this.root.children].indexOf(el)}`;
      const n = used.get(key) || 0;
      used.set(key, n + 1);
      return n * PAREN_STEP + (el.dataset.mark === 'circle' ? CIRCLE : 0);
    };
    for (const { firstEl, lastEl } of this.parens || []) {
      const first = firstEl.getClientRects()[0];
      const lastRects = lastEl.getClientRects();
      const last = lastRects[lastRects.length - 1];
      if (!first || !last) continue;
      const opts = { stroke: color('prep'), strokeWidth: 1.5, roughness: 0.9, seed: seed++ };
      const h = first.height * 0.62;
      const lo = step(firstEl, 'L'), ro = step(lastEl, 'R');
      svg.append(rc.arc(first.left - box.left - 5 - lo, first.top - box.top + first.height * 0.52, 8, h, Math.PI / 2, (3 * Math.PI) / 2, false, opts));
      svg.append(rc.arc(last.right - box.left + 4 + ro, last.top - box.top + last.height * 0.52, 8, h, -Math.PI / 2, Math.PI / 2, false, opts));
    }
    this.root.prepend(svg);
  }

  highlight(uid, cls) {
    for (const s of this.root.querySelectorAll(`.tok.${cls}`)) s.classList.remove(cls);
    if (!uid) return;
    for (const s of this.root.querySelectorAll('.tok')) {
      if ((s.dataset.uids || '').split(' ').includes(uid)) s.classList.add(cls);
    }
  }

  /** Screen rect of the first span showing a unit, for the fly-in animation. */
  rectOf(uid) {
    for (const s of this.root.querySelectorAll('.tok')) {
      if ((s.dataset.uids || '').split(' ').includes(uid)) return s.getBoundingClientRect();
    }
    return null;
  }
}
