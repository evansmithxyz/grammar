// Reed–Kellogg layout.
//
// Everything is built from Blocks: bags of drawing primitives plus a list of
// collision rectangles, in local coordinates. Parents place children with
// collision checks (collideX / collideDown / collideUp), so the diagram stays
// tidy without a global solver.
//
// Conventions inside a block:
//   - a horizontal "line word" has its origin at the left end of its line, y = 0
//   - a hanging element (slant) has its origin at its attach point on the parent line
//
// Two things can't be placed until the surrounding clause is known, so they are
// deferred and resolved at clause level: pedestals (noun clauses, infinitives and
// gerunds raised on a stilt above their slot) and subordinate clauses (drawn
// below, joined by a dashed line).

import { NOMINAL_POS } from '../model/graph.js';

const ANGLE = (60 * Math.PI) / 180;
const DX = Math.cos(ANGLE); // slant direction (down-right)
const DY = Math.sin(ANGLE);
const NX = Math.sin(ANGLE); // text normal (up-right of the slant)
const NY = -Math.cos(ANGLE);

export const METRICS = {
  textH: 15, // cap height of a word, roughly
  textGap: 6, // space between a word and the line under it
  pad: 12, // padding at the ends of a word's line
  slantStart: 11, // how far down a slant its text begins
  gap: 7, // minimum distance between unrelated things
  divUp: 24, // dividers rise this far above a baseline
  divDown: 16, // the subject/verb divider dips below it
  emptySlot: 46,
};

const NOMINAL_RELS = new Set(['subj', 'dobj', 'pred', 'ocomp', 'pobj', 'appos', 'iobj']);
const ROW_RELS = new Set(['subj', 'dobj', 'pred', 'ocomp']);
const SKIP_RELS = new Set(['conj', 'cc', 'intj', 'expl', 'float', 'root']);

class Block {
  constructor() {
    this.prims = [];
    this.rects = [];
    this.anchors = {};
    this.deferred = [];
    this.lineEnd = 0;
  }
  add(p) { this.prims.push(p); return p; }
  rect(x0, y0, x1, y1, tag) {
    this.rects.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), tag });
  }
  lineRect(x1, y1, x2, y2) {
    // thin box around a line, or a chain of boxes for a slanted one
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.ceil(len / 8));
    if (Math.abs(y2 - y1) < 0.5 || Math.abs(x2 - x1) < 0.5) { this.rect(x1 - 1, y1 - 1, x2 + 1, y2 + 1); return; }
    for (let s = 0; s < steps; s++) {
      const a = s / steps, b = (s + 1) / steps;
      this.rect(x1 + (x2 - x1) * a - 1, y1 + (y2 - y1) * a - 1, x1 + (x2 - x1) * b + 1, y1 + (y2 - y1) * b + 1);
    }
  }
  merge(b, dx, dy) {
    for (const p of b.prims) this.prims.push(shiftPrim(p, dx, dy));
    for (const r of b.rects) this.rects.push({ x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy, tag: r.tag });
    for (const [k, a] of Object.entries(b.anchors)) this.anchors[k] = shiftAnchor(a, dx, dy);
    for (const d of b.deferred) this.deferred.push({ ...d, ax: d.ax + dx, ay: d.ay + dy });
    return this;
  }
  bounds() {
    if (!this.rects.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of this.rects) {
      x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1);
    }
    return { x0, y0, x1, y1 };
  }
}

function shiftPrim(p, dx, dy) {
  if (p.t === 'line') return { ...p, x1: p.x1 + dx, y1: p.y1 + dy, x2: p.x2 + dx, y2: p.y2 + dy };
  if (p.t === 'poly') return { ...p, pts: p.pts.map(([x, y]) => [x + dx, y + dy]) };
  return { ...p, x: p.x + dx, y: p.y + dy };
}
function shiftAnchor(a, dx, dy) {
  return { ...a, x0: a.x0 + dx, x1: a.x1 + dx, y: a.y + dy, tx: (a.tx ?? a.x0) + dx };
}

/** Smallest dx that puts `moving` to the right of `fixed` wherever they share rows. */
function collideX(fixed, moving, gap) {
  let need = -Infinity;
  for (const b of moving) {
    for (const a of fixed) {
      if (b.y0 < a.y1 + gap && b.y1 > a.y0 - gap) need = Math.max(need, a.x1 + gap - b.x0);
    }
  }
  return need;
}
/** Smallest dy that puts `moving` (already shifted by dx) below `fixed`. */
function collideDown(fixed, moving, dx, gap) {
  let need = -Infinity;
  for (const b of moving) {
    for (const a of fixed) {
      if (b.x0 + dx < a.x1 + gap && b.x1 + dx > a.x0 - gap) need = Math.max(need, a.y1 + gap - b.y0);
    }
  }
  return need;
}
/** Largest dy (most negative) that puts `moving` (shifted by dx) above `fixed`. */
function collideUp(fixed, moving, dx, gap) {
  let need = Infinity;
  for (const b of moving) {
    for (const a of fixed) {
      if (b.x0 + dx < a.x1 + gap && b.x1 + dx > a.x0 - gap) need = Math.min(need, a.y0 - gap - b.y1);
    }
  }
  return need;
}
function hits(fixed, moving, dx, dy, gap = 0) {
  for (const b of moving) for (const a of fixed) {
    if (b.x0 + dx < a.x1 + gap && b.x1 + dx > a.x0 - gap && b.y0 + dy < a.y1 + gap && b.y1 + dy > a.y0 - gap) return true;
  }
  return false;
}

export function layoutGraph(g, measure) {
  return new Layout(g, measure).run();
}

class Layout {
  constructor(g, measure) {
    this.g = g;
    this.measure = measure;
    this.M = METRICS;
  }

  w(text, kind = 'word') { return this.measure(text, kind); }
  text(u) { return u.understood ? `(${u.text})` : this.g.text(u); }

  run() {
    const g = this.g;
    const out = new Block();
    const sents = [...new Set(g.units.map((u) => u.sent))].sort((a, b) => a - b);
    for (const s of sents) {
      const tops = g.units.filter((u) => u.sent === s && u.head == null);
      const root = tops.find((u) => u.rel === 'root') || tops[0];
      if (!root) continue;
      const B = this.clause(root, { top: true });
      for (const f of tops) if (f !== root) this.float(B, f, 'loose');
      const dy = out.rects.length ? collideDown(out.rects, B.rects, 0, 54) : 0;
      out.merge(B, 0, Number.isFinite(dy) ? dy : 0);
    }
    // units dropped onto something that can't show them still need to appear
    const shown = new Set(out.prims.filter((p) => p.uid).map((p) => p.uid));
    for (const u of g.units) if (!shown.has(u.id)) this.float(out, u, 'loose', true);
    return { prims: this.clipConnectors(out.prims), bounds: out.bounds(), anchors: out.anchors };
  }

  /**
   * Dashed connectors are long and sometimes have no clear path; where one
   * passes behind a word, leave a gap in it so the word stays readable.
   */
  clipConnectors(prims) {
    const M = this.M;
    const boxes = prims.filter((p) => p.t === 'text').map((p) => {
      const small = p.kind === 'label';
      const w = this.w(p.text, small ? 'small' : 'word');
      const h = small ? 13 : M.textH + 1;
      const a = ((p.angle || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      const pt = (dx, dy) => [p.x + dx * c - dy * s, p.y + dx * s + dy * c];
      const poly = [pt(-3, 1), pt(w + 3, 1), pt(w + 3, -h - 3), pt(-3, -h - 3)];
      const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
      return { poly, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    });
    const inside = (x, y, b) => {
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return false;
      let pos = 0, neg = 0;
      for (let k = 0; k < 4; k++) {
        const [ax, ay] = b.poly[k], [bx, by] = b.poly[(k + 1) % 4];
        const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        if (cr > 0) pos++; else if (cr < 0) neg++;
      }
      return pos === 4 || neg === 4;
    };
    const out = [];
    for (const p of prims) {
      if (p.t !== 'line' || p.kind !== 'conn') { out.push(p); continue; }
      const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
      const near = boxes.filter((b) => Math.max(p.x1, p.x2) >= b.x0 && Math.min(p.x1, p.x2) <= b.x1
        && Math.max(p.y1, p.y2) >= b.y0 && Math.min(p.y1, p.y2) <= b.y1);
      if (!near.length || len < 1) { out.push(p); continue; }
      const n = Math.ceil(len);
      const pieces = [];
      let start = null;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const blocked = near.some((b) => inside(p.x1 + (p.x2 - p.x1) * t, p.y1 + (p.y2 - p.y1) * t, b));
        if (!blocked && start == null) start = t;
        if (start != null && (blocked || i === n)) {
          const end = blocked ? (i - 1) / n : t;
          if ((end - start) * len > 3) pieces.push([start, end]);
          start = null;
        }
      }
      for (const [a, b] of pieces) {
        out.push({ ...p, x1: p.x1 + (p.x2 - p.x1) * a, y1: p.y1 + (p.y2 - p.y1) * a, x2: p.x1 + (p.x2 - p.x1) * b, y2: p.y1 + (p.y2 - p.y1) * b });
      }
    }
    return out;
  }

  // ---------- hanging elements (slanted lines under a word) ----------

  /** Kids drawn hanging under `u`'s line. */
  hangingKids(u, asRow) {
    const g = this.g;
    return g.kids(u).filter((k) => {
      if (SKIP_RELS.has(k.rel)) return false;
      if (asRow && ROW_RELS.has(k.rel)) return false;
      if (k.rel === 'appos') return false;
      if (k.rel === 'mark' && g.isVerbal(u)) return false;
      // a preposition's object sits at the foot of its slant, not hanging under it
      if (k.rel === 'pobj' && this.isPrep(u)) return false;
      return true;
    });
  }

  isClauseLink(k) { return (k.rel === 'advcl' || k.rel === 'relcl') && this.g.isVerbal(k); }

  /**
   * Drawn as a preposition, with its object at the foot of the slant. Goes by
   * the word's job as well as its part of speech: spaCy tags "except" and
   * "because" as conjunctions even when they head a phrase.
   */
  isPrep(u) {
    return u.rel === 'prep' || u.pos === 'PREP' || (u.pos === 'TO' && !!this.g.kid(u, 'pobj'));
  }

  /** A slant from (0,0) down-right, optionally carrying text. Returns block + bottom point. */
  slant(text, uid, kind, minLen = 0, dash = false) {
    const B = new Block();
    const M = this.M;
    const tw = text ? this.w(text) : 0;
    const L = Math.max(minLen, text ? M.slantStart + tw + 9 : 34);
    const bx = L * DX, by = L * DY;
    B.add({ t: 'line', x1: 0, y1: 0, x2: bx, y2: by, kind: dash ? 'conn' : 'slant', dash, uid: dash ? undefined : uid });
    B.lineRect(0, 0, bx, by);
    if (text) {
      const s0 = M.slantStart;
      const x = s0 * DX + NX * 3, y = s0 * DY + NY * 3;
      B.add({ t: 'text', x, y, angle: 60, text, uid, kind });
      for (let s = s0 - 2; s <= s0 + tw + 2; s += 6) {
        const px = s * DX, py = s * DY;
        const qx = px + NX * (M.textH + 4), qy = py + NY * (M.textH + 4);
        B.rect(Math.min(px, qx), Math.min(py, qy), Math.max(px, qx), Math.max(py, qy), 'text');
      }
    }
    return { B, bx, by, L };
  }

  hanging(u, opts = {}) {
    const g = this.g;
    if (this.isClauseLink(u)) {
      // a dashed slant (carrying the subordinator) leads down to the clause,
      // which is hung below everything once the clause around it is laid out
      const mark = u.rel === 'advcl' ? g.kids(u, 'mark')[0] : null;
      const { B, bx, by } = this.slant(mark ? g.text(mark) : '', mark?.id, 'word', 44, true);
      B.deferred.push({ kind: 'clause', unit: u, ax: bx, ay: by });
      return B;
    }
    // A compound verb ("to hold and enjoy") is drawn by its verb row's fork,
    // unless each part repeats its own "to" ("to hold and to enjoy").
    if (!opts.noCompound && this.parts(u).length > 1 && (!g.isVerbal(u) || this.ownInfinitives(u))) return this.hangingCompound(u);

    const isPrep = this.isPrep(u);
    if (g.isVerbal(u) && u.rel !== 'prep') {
      const to = g.kids(u, 'mark').find((m) => /^to$/i.test(g.text(m)));
      if (to) {
        // infinitive phrase: "to" on the slant, the verb phrase on the flat
        const R = this.verbRow(u, { leftPad: 16, noFork: opts.noCompound });
        const { B, bx, by } = this.slant(g.text(to), to.id, 'word', Math.max(opts.minLen ?? 0, this.below(R)));
        B.merge(R, bx, by);
        return B;
      }
      // participle: bent line, word written along the bend
      const R = this.verbRow(u, { leftPad: 10, participle: true, noFork: opts.noCompound });
      const { B, bx, by } = this.slant('', u.id, 'word', Math.max(30, opts.minLen ?? 0, this.below(R)));
      B.merge(R, bx, by);
      return B;
    }
    if (isPrep) {
      const obj = g.kid(u, 'pobj');
      const O = obj ? this.slot(obj, { leftPad: 18 }) : null;
      const { B, bx, by } = this.slant(this.text(u), u.id, 'word', Math.max(obj ? 40 : 0, opts.minLen ?? 0, O ? this.below(O) : 0));
      if (O) B.merge(O, bx, by);
      this.ledge(B, u, bx, by, !!obj);
      return B;
    }
    if (u.rel === 'iobj' || (u.rel === 'npadv' && this.hangingKids(u).length) || (NOMINAL_POS.has(u.pos) && this.hangingKids(u).length && u.rel !== 'mod')) {
      // empty slant then the word on a flat line (indirect objects, adverbial nouns)
      const S = this.slot(u, { leftPad: 14 });
      const { B, bx, by } = this.slant('', null, 'word', Math.max(32, opts.minLen ?? 0, this.below(S)));
      B.merge(S, bx, by);
      return B;
    }
    const { B, bx, by } = this.slant(this.text(u), u.id, u.understood ? 'understood' : 'word', opts.minLen);
    B.anchors[u.id] = { x0: 0, x1: bx, y: 0, slant: true, bx, by };
    this.ledge(B, u, bx, by, false);
    return B;
  }

  /**
   * How long a slant must be for `block`, hung at its foot, to sit wholly
   * below the line the slant leaves from (a compound object's top branch
   * otherwise rises into the words above).
   */
  below(block) {
    return (8 - block.bounds().y0) / DY;
  }

  /** "to hold and to enjoy": every part of the compound has its own "to". */
  ownInfinitives(u) {
    const g = this.g;
    const hasTo = (v) => g.kids(v, 'mark').some((m) => /^to$/i.test(g.text(m)));
    return this.parts(u).every(hasTo);
  }

  /** Modifiers of a slanted word hang from a short ledge at the slant's foot. */
  ledge(B, u, bx, by, hasObjLine) {
    const kids = this.hangingKids(u);
    if (!kids.length) return;
    if (hasObjLine) {
      // modifiers of a preposition hang from its slant, partway down
      const L = new Block();
      this.placeHanging(L, kids, 0);
      const ax = bx * 0.45, ay = by * 0.45;
      B.add({ t: 'line', x1: ax, y1: ay, x2: ax - 18, y2: ay, kind: 'ledge' });
      B.merge(L, ax - 18 - L.lineEnd, ay);
      return;
    }
    const L = new Block();
    const end = this.placeHanging(L, kids, 6);
    const len = Math.max(end + 16, 24);
    L.add({ t: 'line', x1: 0, y1: 0, x2: len, y2: 0, kind: 'ledge' });
    L.lineRect(0, 0, len, 0);
    B.merge(L, bx, by);
  }

  /** Lay hanging kids left to right under a line. Returns x of the last attach point. */
  placeHanging(B, kids, x0) {
    let x = x0, last = x0;
    const placed = [];
    for (const k of kids) {
      const H = this.hanging(k);
      let dx = Math.max(x, collideX(placed, H.rects, this.M.gap));
      // keep the attach point clear of the previous slant's text
      B.merge(H, dx, 0);
      for (const r of H.rects) placed.push({ ...r, x0: r.x0 + dx, x1: r.x1 + dx });
      last = dx + (H.attachEnd || 0);
      x = last + 14;
    }
    B.lineEnd = Math.max(B.lineEnd, last);
    return kids.length ? last : x0 - 6;
  }

  /**
   * Compound modifiers / phrases: slants side by side, joined by a dashed line
   * that carries the conjunction. The slants are drawn a little longer than
   * their words so the dashed line can cross below the words; where exactly it
   * goes is found by searching for a spot that touches nothing.
   */
  hangingCompound(u) {
    const g = this.g;
    const M = this.M;
    const items = this.parts(u);
    // each conjunction rides the connector into the part it introduces
    // ("slowly, quietly and carefully" has one; "A and B, C, and D" has two)
    const ccOf = (it) => g.kid(it, 'cc');
    const slantText = (it) => {
      if (g.isVerbal(it)) { const to = g.kids(it, 'mark').find((m) => /^to$/i.test(g.text(m))); return to ? g.text(to) : ''; }
      if (it.rel === 'iobj' || it.rel === 'npadv') return '';
      return this.text(it);
    };
    const hasFoot = items.some((it) => g.isVerbal(it) || g.kid(it, 'pobj') || this.hangingKids(it).length || it.rel === 'iobj');
    const longest = Math.max(...items.map((it) => M.slantStart + this.w(slantText(it)) + 9));
    const minLen = longest + (hasFoot ? 40 : 24);
    const maxDepth = minLen * DY;

    const B = new Block();
    const placed = [];
    const xs = [];
    let x = 0;
    items.forEach((it, k) => {
      const H = this.hanging(it, { noCompound: true, minLen });
      let dx = Math.max(x, collideX(placed, H.rects, M.gap));
      let conn = null;
      const cc = k > 0 ? ccOf(it) : null;
      const labelW = cc ? this.w(g.text(cc), 'small') : 0;
      if (k > 0) dx = Math.max(dx, xs[k - 1] + (labelW ? labelW + 30 : 26));
      for (let tries = 0; k > 0 && tries < 30 && !conn; tries++) {
        conn = this.findConnector(placed, H.rects, xs[k - 1], dx, maxDepth, labelW);
        if (!conn) dx += 5;
      }
      B.merge(H, dx, 0);
      for (const r of H.rects) placed.push({ ...r, x0: r.x0 + dx, x1: r.x1 + dx });
      xs.push(dx);
      if (k > 0) {
        const y = conn ? conn.y : maxDepth * 0.6;
        const tan = DX / DY;
        const xa = xs[k - 1] + y * tan, xb = dx + y * tan;
        B.add({ t: 'line', x1: xa, y1: y, x2: xb, y2: y, dash: true, kind: 'conn', uid: cc?.id });
        placed.push({ x0: xa, x1: xb, y0: y - 1, y1: y + 1 });
        if (cc) {
          const lx = conn ? conn.lx : (xa + xb) / 2 - labelW / 2;
          const ly = conn ? conn.ly : y - 3;
          B.add({ t: 'text', x: lx, y: ly, text: g.text(cc), uid: cc.id, kind: 'label' });
          B.rect(lx, ly - 11, lx + labelW, ly + 2, 'text');
          placed.push({ x0: lx, x1: lx + labelW, y0: ly - 11, y1: ly + 2 });
        }
      }
      x = dx + 30;
    });
    B.lineEnd = xs.at(-1);
    B.attachEnd = xs.at(-1);
    return B;
  }

  /** Where a dashed connector (and its label) can cross between two slants without touching anything. */
  findConnector(placed, rects, xPrev, dx, maxDepth, labelW) {
    const tan = DX / DY;
    const all = placed.concat(rects.map((r) => ({ ...r, x0: r.x0 + dx, x1: r.x1 + dx })));
    for (let y = 10; y <= maxDepth - 3; y += 2) {
      const xa = xPrev + y * tan, xb = dx + y * tan;
      if (xb - xa < (labelW ? labelW + 16 : 14)) continue;
      // stay clear of the boxes around the two slant lines themselves
      if (hits(all, [{ x0: xa + 6, x1: xb - 6, y0: y - 1.5, y1: y + 1.5 }], 0, 0, 0.5)) continue;
      if (!labelW) return { y };
      // the room between two parallel slants shifts right as it goes down, so
      // centre the label in that parallelogram, just below or above the line
      for (const [ly, lo, hi] of [[y + 15, xa + 15 * tan + 6, xb - 6], [y - 3, xa + 6, xb - 15 * tan - 6]]) {
        const lx = (lo + hi) / 2 - labelW / 2;
        if (lx < lo || lx + labelW > hi) continue;
        if (!hits(all, [{ x0: lx - 1, x1: lx + labelW + 1, y0: ly - 12, y1: ly + 3 }], 0, 0, 0.5)) return { y, lx, ly };
      }
    }
    return null;
  }

  // ---------- horizontal slots ----------

  /** Something sitting on a horizontal line: a word, a compound fork, or a pedestal. */
  slot(u, opts = {}) {
    const g = this.g;
    // a compound rejoins the line only when something follows it on that line
    const pedestal = g.isVerbal(u) && NOMINAL_RELS.has(u.rel);
    if (!opts.noCompound && this.parts(u).length > 1 && (!pedestal || this.ownInfinitives(u))) {
      return this.fork(u, { ...opts, open: opts.open ?? !opts.followed });
    }
    if (pedestal) return this.stiltSlot(u, opts);
    return this.wordLine(u, opts);
  }

  /** A word on a line with its modifiers hanging below. */
  wordLine(u, opts = {}) {
    const g = this.g;
    const M = this.M;
    const B = new Block();
    const leftPad = opts.leftPad ?? M.pad;
    const label = opts.text ?? this.text(u);
    const tw = this.w(label);
    const kids = opts.kids ?? this.hangingKids(u, opts.asRow);
    const last = this.placeHanging(B, kids, leftPad + 2);
    let segEnd = Math.max(leftPad + tw + M.pad, kids.length ? last + 26 : 0);

    // appositives sit beside the word in parentheses
    const apps = g.kids(u, 'appos');
    const appParts = [];
    for (const a of apps) {
      const A = this.wordLine(a, { text: `(${this.text(a)})`, leftPad: 6, noLine: true });
      const dx = Math.max(segEnd, collideX(B.rects, A.rects, M.gap));
      appParts.push([A, dx]);
      segEnd = dx + A.lineEnd;
    }
    for (const [A, dx] of appParts) B.merge(A, dx, 0);

    const lineEnd = Math.max(opts.lineWidth ?? 0, segEnd);
    const span = appParts.length ? appParts[0][1] : Math.max(opts.textSpan ?? 0, lineEnd);
    const tx = Math.max(leftPad, (span - tw) / 2 + (leftPad > M.pad ? (leftPad - M.pad) / 2 : 0));
    const kind = u.understood ? 'understood' : 'word';
    if (opts.step) {
      // gerund: a stepped line
      B.add({ t: 'poly', pts: [[0, -8], [9, -8], [9, 0], [lineEnd, 0]], kind: 'base', uid: opts.lineUid });
      B.lineRect(0, -8, 9, -8);
      B.lineRect(9, 0, lineEnd, 0);
    } else if (!opts.noLine) {
      B.add({ t: 'line', x1: 0, y1: 0, x2: lineEnd, y2: 0, kind: 'base', uid: opts.lineUid });
      B.lineRect(0, 0, lineEnd, 0);
    }
    if (opts.participle && label.length > 3) {
      // write the participle across the bend: part on the slant, rest on the flat
      B.add({ t: 'text', x: Math.max(tx, 12), y: -M.textGap, text: label, uid: u.id, kind });
    } else {
      B.add({ t: 'text', x: tx + (opts.step ? 6 : 0), y: -M.textGap, text: label, uid: u.id, kind });
    }
    B.rect(tx, -M.textGap - M.textH, tx + tw + (opts.step ? 6 : 0), -M.textGap + 4, 'text');
    B.anchors[u.id] = { x0: 0, x1: span, y: 0, tx, tw };
    B.lineEnd = lineEnd;
    return B;
  }

  /**
   * A compound's parts, starting with `u`. A joined verb with its own subject
   * is a separate clause (drawn by compoundClauses), not one of the parts.
   */
  parts(u) {
    const g = this.g;
    return [u, ...g.kids(u, 'conj').filter((c) => !(g.isVerbal(c) && g.kid(c, 'subj')))];
  }

  /** Compound parts on parallel lines that split from and rejoin the main line. */
  fork(u, opts = {}, itemBuilder) {
    const g = this.g;
    const M = this.M;
    const items = this.parts(u);
    // every conjunction gets drawn: a lone one sits in the middle of the fork;
    // with more ("A, B and C, D, and E") each sits beside the part it introduces.
    // One on the first part joins it to what came before, not to this fork.
    const ccs = items.map((it, k) => ({ cc: k > 0 && g.kid(it, 'cc'), k })).filter((x) => x.cc);
    const cc = ccs.at(-1)?.cc;
    const ccW = Math.max(0, ...ccs.map((x) => this.w(g.text(x.cc), 'small')));
    const build = itemBuilder || ((it, o) => this.slot(it, { ...o, noCompound: true }));
    // the conjunction sits in the mouth of the fork, beside a dashed line
    // joining the tines where they begin
    const arm = Math.max(30, ccW + 32);

    const pass = (width) => {
      const blocks = items.map((it) => build(it, { lineWidth: width, textSpan: width }));
      const B = new Block();
      const ys = [];
      const placed = [];
      blocks.forEach((T, k) => {
        let y = 0;
        if (k > 0) {
          const d = collideDown(placed, T.rects, arm, M.gap + 4);
          y = Math.max(ys[k - 1] + 42, Number.isFinite(d) ? d : 0);
        }
        ys.push(y);
        for (const r of T.rects) placed.push({ ...r, x0: r.x0 + arm, x1: r.x1 + arm, y0: r.y0 + y, y1: r.y1 + y });
      });
      return { blocks, ys, placed };
    };

    let { blocks, ys } = pass(0);
    const natural = Math.max(...blocks.map((b) => b.lineEnd));
    const tineLen = Math.max(natural, opts.lineWidth ? opts.lineWidth - (opts.open ? arm : 2 * arm) : 0);
    ({ blocks, ys } = pass(tineLen));
    const midY = (ys[0] + ys.at(-1)) / 2;
    const dashX = arm;

    const B = new Block();
    const shift = -midY;
    const end = arm + tineLen;
    blocks.forEach((T, k) => {
      const y = ys[k] + shift;
      B.merge(T, arm, y);
      B.add({ t: 'line', x1: 0, y1: 0, x2: arm, y2: y, kind: 'base' });
      B.lineRect(0, 0, arm, y);
      if (!opts.open) {
        B.add({ t: 'line', x1: end, y1: y, x2: end + arm, y2: 0, kind: 'base' });
        B.lineRect(end, y, end + arm, 0);
      }
    });
    const y0 = ys[0] + shift, y1 = ys.at(-1) + shift;
    B.add({ t: 'line', x1: dashX, y1: y0, x2: dashX, y2: y1, dash: true, kind: 'conn', uid: cc?.id });
    for (const { cc: c, k: own } of ccs) {
      // a lone conjunction goes midway between the two middle branches (with an
      // odd count, the middle branch runs straight through the centre)
      const k = ccs.length === 1 ? Math.max(1, Math.floor(blocks.length / 2)) : own;
      const ya = ys[k - 1] + shift, yb = ys[k] + shift;
      const w = this.w(g.text(c), 'small');
      const lx = dashX - w - 6;
      const yc = ((lx + w / 2) / arm) * ((ya + yb) / 2);
      B.add({ t: 'text', x: lx, y: yc + 5, text: g.text(c), uid: c.id, kind: 'label' });
      B.rect(lx, yc - 8, lx + w, yc + 6, 'text');
    }
    let lineEnd = opts.open ? Math.max(...blocks.map((b) => b.lineEnd)) + arm : end + arm;
    if (!opts.open && opts.lineWidth && opts.lineWidth > lineEnd) {
      B.add({ t: 'line', x1: lineEnd, y1: 0, x2: opts.lineWidth, y2: 0, kind: 'base' });
      B.lineRect(lineEnd, 0, opts.lineWidth, 0);
      lineEnd = opts.lineWidth;
    }
    B.lineEnd = lineEnd;
    B.anchors[`fork:${u.id}`] = { x0: 0, x1: lineEnd, y: 0 };
    return B;
  }

  /** An empty slot with a pedestal; the phrase itself is raised above it later. */
  stiltSlot(u, opts = {}) {
    const M = this.M;
    const B = new Block();
    const w = Math.max(opts.lineWidth ?? 0, M.emptySlot + (opts.leftPad ?? 0));
    const span = opts.textSpan || w;
    const cx = Math.max((opts.leftPad ?? 0) + 14, span / 2);
    B.add({ t: 'line', x1: 0, y1: 0, x2: w, y2: 0, kind: 'base' });
    B.lineRect(0, 0, w, 0);
    // room for the foot; it's drawn once the stem's spot along the line is chosen
    B.rect(cx - 8, -9, cx + 8, 0);
    B.deferred.push({ kind: 'stilt', unit: u, ax: cx, ay: -9, noFork: !!opts.noCompound, lo: 10 - cx, hi: w - 10 - cx });
    B.anchors[`slot:${u.id}`] = { x0: 0, x1: span, y: 0 };
    B.lineEnd = w;
    return B;
  }

  /** What sits on top of a pedestal: a noun clause, an infinitive, or a gerund. */
  stiltContent(u, noFork = false) {
    const g = this.g;
    if (g.kid(u, 'subj')) {
      const C = this.clause(u, {});
      return { C, cx: this.stemX(C, C.rowStart, C.rowEnd, 0), cy: 0 };
    }
    const to = g.kids(u, 'mark').find((m) => /^to$/i.test(g.text(m)));
    if (to) {
      const { B, bx, by } = this.slant(g.text(to), to.id, 'word');
      const R = this.verbRow(u, { leftPad: 16, noFork });
      B.merge(R, bx, by);
      return { C: B, cx: this.stemX(B, bx, bx + R.lineEnd, by), cy: by };
    }
    const R = this.verbRow(u, { step: true, noFork });
    return { C: R, cx: this.stemX(R, 9, R.lineEnd, 0), cy: 0 };
  }

  /** A spot on a raised line where a pedestal stem can rise without hitting anything hanging below it. */
  stemX(C, x0, x1, y) {
    const below = C.rects.filter((r) => r.y1 > y + 3);
    const free = (x) => !below.some((r) => r.x0 < x + 3 && r.x1 > x - 3);
    const mid = (x0 + x1) / 2;
    for (let d = 0; d <= (x1 - x0) / 2; d += 4) {
      if (mid - d > x0 + 4 && free(mid - d)) return mid - d;
      if (mid + d < x1 - 4 && free(mid + d)) return mid + d;
    }
    return x0 + 6;
  }

  // ---------- rows and clauses ----------

  /**
   * Lay out segments on one line with dividers between them.
   * segs: [{ build(opts) -> Block, div: 'cross' | 'obj' | 'comp' }]
   */
  row(segs) {
    const M = this.M;
    const divPad = { cross: 16, obj: 12, comp: 14 };
    const first = segs.map((s, k) => s.build({ followed: k < segs.length - 1 }));
    const xs = [];
    const placed = new Block();
    first.forEach((S, k) => {
      let x = 0;
      if (k > 0) {
        const pad = divPad[segs[k].div] ?? 12;
        const prevEnd = xs[k - 1] + first[k - 1].lineEnd;
        const probe = segs[k].div === 'cross' ? [{ x0: -pad - 3, x1: -pad + 3, y0: 1, y1: M.divDown + 3 }] : [];
        x = Math.max(prevEnd + pad * 2, collideX(placed.rects, [...S.rects, ...probe], M.gap) + 4);
      }
      xs.push(x);
      placed.merge(S, x, 0);
    });
    // second pass: stretch each segment to meet the next divider so words center
    const B = new Block();
    segs.forEach((seg, k) => {
      const next = k + 1 < segs.length ? xs[k + 1] : null;
      const pad = next != null ? divPad[segs[k + 1].div] ?? 12 : 0;
      const lineWidth = next != null ? next - xs[k] : first[k].lineEnd;
      const textSpan = next != null ? next - pad - xs[k] : lineWidth;
      const S = seg.build({ lineWidth, textSpan, followed: next != null });
      B.merge(S, xs[k], 0);
      if (next != null) {
        const dx = next - pad;
        const div = segs[k + 1].div;
        const p = div === 'cross' ? [dx, -M.divUp, dx, M.divDown] : div === 'obj' ? [dx, -M.divUp, dx, 0] : [dx - 10, -M.divUp, dx, 0];
        B.add({ t: 'line', x1: p[0], y1: p[1], x2: p[2], y2: p[3], kind: 'div', div });
        B.lineRect(p[0], p[1], p[2], p[3]);
        if (div === 'cross') B.anchors.divider = { x0: dx, x1: dx, y: 0 };
      }
    });
    B.lineEnd = xs.at(-1) + first.at(-1).lineEnd;
    B.segXs = xs;
    return B;
  }

  /** verb | object \ complement — the part of a row from the verb on. */
  predSegs(v, opts = {}) {
    const g = this.g;
    const segs = [];
    const verbOpts = { asRow: true, leftPad: opts.leftPad, step: opts.step, participle: opts.participle };
    const conjVerbs = g.kids(v, 'conj').filter((c) => g.isVerbal(c) && !g.kid(c, 'subj'));
    const comps = (u) => [...g.kids(u, 'dobj'), ...g.kids(u, 'ocomp'), ...g.kids(u, 'pred')];
    if (conjVerbs.length && !opts.noFork) {
      // compound predicate. Shared objects (only on the first verb, after the
      // last verb) stay on the main line; otherwise each tine gets its own.
      const lastVerbTok = Math.max(...conjVerbs.map((c) => g.order(c)));
      const ownComps = comps(v);
      const shared = ownComps.length && conjVerbs.every((c) => !comps(c).length) && ownComps.every((c) => g.order(c) > lastVerbTok);
      segs.push({
        build: (o) => this.fork(v, { ...o, open: !shared }, (it, io) => shared
          ? this.wordLine(it, { asRow: true, lineWidth: io.lineWidth, textSpan: io.textSpan })
          : this.row(this.predSegs(it, { noFork: true }))),
      });
      if (shared) this.compSegs(v, segs);
      return segs;
    }
    segs.push({ build: (o) => this.wordLine(v, { ...verbOpts, ...o }) });
    this.compSegs(v, segs);
    return segs;
  }

  compSegs(v, segs) {
    const g = this.g;
    for (const d of g.kids(v, 'dobj')) segs.push({ div: 'obj', build: (o) => this.slot(d, o) });
    for (const c of g.kids(v, 'ocomp')) segs.push({ div: 'comp', build: (o) => this.slot(c, o) });
    for (const p of g.kids(v, 'pred')) segs.push({ div: 'comp', build: (o) => this.slot(p, o) });
  }

  /** A verbal's own line: verb | object ... (no subject). */
  verbRow(v, opts = {}) {
    const R = this.row(this.predSegs(v, opts));
    this.resolve(R);
    return R;
  }

  /** A full clause, including compound clauses, floats and sub-clauses. */
  clause(v, opts = {}) {
    const g = this.g;
    if (!g.isVerbal(v)) {
      // a fragment: draw the word on its own line
      const B = this.slot(v, {});
      this.resolve(B);
      B.rowStart = 0; B.rowEnd = B.lineEnd;
      this.floats(B, v);
      return B;
    }
    const others = g.kids(v, 'conj').filter((c) => g.isVerbal(c) && g.kid(c, 'subj'));
    if (others.length) return this.compoundClauses(v, others);
    return this.singleClause(v, opts);
  }

  singleClause(v, opts = {}) {
    const g = this.g;
    const subj = g.kid(v, 'subj');
    const segs = [{ build: (o) => (subj ? this.slot(subj, o) : this.emptySlot(o, v)) }];
    const pred = this.predSegs(v);
    pred[0].div = 'cross';
    segs.push(...pred);
    const B = this.row(segs);
    B.rowStart = 0;
    B.rowEnd = B.lineEnd;

    // "that" / "whether" introducing a noun clause floats above the verb
    const marks = g.kids(v, 'mark').filter((m) => !/^to$/i.test(g.text(m)));
    if (marks.length && v.rel !== 'advcl') {
      const a = B.anchors[v.id];
      for (const m of marks) {
        const mw = this.w(g.text(m));
        const M = new Block();
        const len = mw + 2 * this.M.pad;
        M.add({ t: 'line', x1: 0, y1: 0, x2: len, y2: 0, kind: 'base' });
        M.lineRect(0, 0, len, 0);
        M.add({ t: 'text', x: this.M.pad, y: -this.M.textGap, text: g.text(m), uid: m.id, kind: 'word' });
        M.rect(this.M.pad, -this.M.textGap - this.M.textH, this.M.pad + mw, 0, 'text');
        const cx = a ? a.x0 + 8 : B.rowEnd / 2; // left of the verb's word
        const mx = cx - len / 2;
        let my = collideUp(B.rects, M.rects, mx, 10);
        my = Math.min(Number.isFinite(my) ? my : -40, -40);
        B.merge(M, mx, my);
        B.add({ t: 'line', x1: cx, y1: my, x2: cx, y2: 0, dash: true, kind: 'conn' });
      }
    }
    this.resolve(B);
    this.floats(B, v);
    return B;
  }

  /** A subject slot with nothing in it yet (the build-from-scratch mode lets you drop a word here). */
  emptySlot(o, verb) {
    const B = new Block();
    const w = Math.max(o.lineWidth ?? 0, this.M.emptySlot);
    B.add({ t: 'line', x1: 0, y1: 0, x2: w, y2: 0, kind: 'base' });
    B.lineRect(0, 0, w, 0);
    if (verb) B.anchors[`subjslot:${verb.id}`] = { x0: 0, x1: o.textSpan || w, y: 0 };
    B.lineEnd = w;
    return B;
  }

  /**
   * Independent clauses stacked, verbs joined by a dashed step that carries
   * the conjunction. The step drops from the first verb through a column with
   * nothing in it (clauses hung below the first one stay uncrossed when
   * possible), and the conjunction sits just above the next clause.
   */
  compoundClauses(v, others) {
    const g = this.g;
    const B = new Block();
    let prevVerb = null;
    let prevY = 0;
    [v, ...others].forEach((cv) => {
      const C = this.singleClause(cv);
      if (!prevVerb) {
        B.merge(C, 0, 0);
        B.rowStart = C.rowStart; B.rowEnd = C.rowEnd;
        prevVerb = cv;
        return;
      }
      const cc = g.kid(cv, 'cc');
      const ccText = cc ? g.text(cc) : '';
      const ccW = ccText ? this.w(ccText, 'small') : 0;
      const pa = B.anchors[prevVerb.id];
      const ca = C.anchors[cv.id];
      const lineY = pa ? pa.y : prevY;
      // just right of a divider, before the verb's words and slants begin
      const lo = pa ? pa.x0 + 6 : 24;
      const px = this.clearColumn(B.rects, lo, pa ? Math.max(lo, pa.x1 - 6) : lo, lineY + 3, B.bounds().y1);
      const run = Math.max(34, ccW + 22);
      const x2 = px + run;
      const dx = x2 - (ca ? ca.x0 + 6 : 24);
      // keep room above the next clause for the step and its conjunction
      const top = C.bounds().y0;
      const room = [{ x0: px - dx - 4, x1: x2 - dx + 4, y0: top - 34, y1: top }];
      let dy = collideDown(B.rects, [...C.rects, ...room], dx, 12);
      dy = Math.max(Number.isFinite(dy) ? dy : 0, lineY + 70);
      B.merge(C, dx, dy);
      const yStep = dy + top - 14;
      const yEnd = (ca ? ca.y : 0) + dy;
      B.add({ t: 'line', x1: px, y1: lineY, x2: px, y2: yStep, dash: true, kind: 'conn' });
      B.add({ t: 'line', x1: px, y1: yStep, x2, y2: yStep, kind: 'conn', uid: cc?.id });
      B.add({ t: 'line', x1: x2, y1: yStep, x2, y2: yEnd, dash: true, kind: 'conn' });
      B.lineRect(px, lineY + 2, px, yStep);
      B.lineRect(px, yStep, x2, yStep);
      B.lineRect(x2, yStep, x2, yEnd - 2);
      if (cc) {
        const lx = px + (run - ccW) / 2;
        B.add({ t: 'text', x: lx, y: yStep - 5, text: ccText, uid: cc.id, kind: 'label' });
        B.rect(lx, yStep - 17, lx + ccW, yStep - 3, 'text');
      }
      prevVerb = cv;
      prevY = dy;
    });
    return B;
  }

  /**
   * Where along a pedestal's line (x from lo to hi) its stem can rise from
   * yFoot to yTop crossing the least: a word is far worse than a line, and a
   * line close beside the stem counts a little, for breathing room. Spots past
   * the line's end are allowed at a small cost per pixel of extra line (and
   * the extra line mustn't run into anything). Ties go to the spot nearest
   * `mid`, the middle of the line.
   */
  stemFoot(rects, lo, hi, mid, yTop, yFoot, lineY) {
    const end = hi + 10;
    let best = mid, cost = Infinity;
    for (let x = Math.min(lo, hi); x <= Math.max(lo, hi) + 220; x += 2) {
      let c = Math.abs(x - mid) / 1000;
      for (const r of rects) {
        if (r.y1 <= yTop || r.y0 >= yFoot) continue;
        const hit = r.x0 < x + 4 && r.x1 > x - 4, near = r.x0 < x + 10 && r.x1 > x - 10;
        if (hit) c += r.tag === 'text' ? 10 : 1;
        else if (near) c += 0.2;
      }
      if (x + 14 > end) {
        c += (x + 14 - end) * 0.01;
        for (const r of rects) {
          if (r.y0 < lineY + 6 && r.y1 > lineY - 6 && r.x1 > end && r.x0 < x + 16) c += r.tag === 'text' ? 10 : 2;
        }
      }
      if (c < cost) { best = x; cost = c; }
    }
    return best;
  }

  /** The x in [lo, hi] where a vertical line from y0 to y1 runs into the fewest things. */
  clearColumn(rects, lo, hi, y0, y1) {
    let best = lo, fewest = Infinity;
    for (let x = lo; x <= hi; x += 4) {
      let n = 0;
      for (const r of rects) if (r.x0 < x + 3 && r.x1 > x - 3 && r.y1 > y0 && r.y0 < y1) n += r.tag === 'text' ? 10 : 1;
      if (n < fewest) { best = x; fewest = n; }
      if (!n) break;
    }
    return best;
  }

  /** Raise pedestals and hang sub-clauses that this block collected. */
  resolve(B) {
    const g = this.g;
    for (let guard = 0; guard < 50 && B.deferred.length; guard++) {
      const d = B.deferred.shift();
      if (d.kind === 'stilt') {
        const { C, cx, cy } = this.stiltContent(d.unit, d.noFork);
        // the stem rises from wherever along its line it crosses the least on
        // the way up, carrying the line on to the right if it has to
        const lineY = d.ay + 9, lineEnd = d.ax + d.hi + 10;
        const fx = this.stemFoot(B.rects, d.ax + d.lo, d.ax + d.hi, d.ax, B.bounds().y0, d.ay, lineY);
        if (fx + 14 > lineEnd) {
          B.add({ t: 'line', x1: lineEnd, y1: lineY, x2: fx + 14, y2: lineY, kind: 'base' });
          B.lineRect(lineEnd, lineY, fx + 14, lineY);
        }
        const x = fx - cx;
        let lift = collideUp(B.rects, C.rects, x, 10);
        const yTop = Math.min(Number.isFinite(lift) ? lift : 0, d.ay - 26 - cy - C.bounds().y1 + cy);
        const y = Math.min(yTop, d.ay - 34 - (C.bounds().y1 - cy) - cy);
        B.merge(C, x, y);
        B.add({ t: 'poly', pts: [[fx - 8, d.ay + 9], [fx, d.ay], [fx + 8, d.ay + 9]], kind: 'stem' });
        B.add({ t: 'line', x1: fx, y1: d.ay, x2: fx, y2: y + cy, kind: 'stem' });
        B.lineRect(fx, d.ay, fx, y + cy);
      } else if (d.kind === 'clause') {
        const C = this.clause(d.unit, {});
        let target = C.anchors[d.unit.id];
        if (d.unit.rel === 'relcl') {
          const rp = g.units.find((u) => u.relPron && C.anchors[u.id] && g.dominates(d.unit, u));
          if (rp) target = C.anchors[rp.id];
        }
        // aim at the top of the target word, so the dashed line doesn't cross it
        let tx, ty;
        if (!target) { tx = C.rowEnd / 2; ty = -this.M.textGap - this.M.textH - 4; }
        else if (target.slant) { tx = target.x0 + target.bx * 0.35; ty = target.y + target.by * 0.35; }
        else { tx = (target.tx ?? target.x0) + (target.tw ?? 0) / 2; ty = target.y - this.M.textGap - this.M.textH - 4; }
        const x = d.ax + 8 - tx;
        let dy = collideDown(B.rects, C.rects, x, 22);
        dy = Math.max(Number.isFinite(dy) ? dy : 0, d.ay + 26 - ty);
        B.merge(C, x, dy);
        B.add({ t: 'line', x1: d.ax, y1: d.ay, x2: tx + x, y2: ty + dy, dash: true, kind: 'conn' });
        B.lineRect(d.ax, d.ay, tx + x, ty + dy);
      }
    }
  }

  /** Interjections, expletives and nouns of address float above the clause. */
  floats(B, v) {
    for (const f of this.g.kids(v, 'intj', 'expl')) this.float(B, f, 'float');
  }

  float(B, u, kind, bare = false) {
    const W = bare ? this.wordLine(u, { kids: [] }) : this.slot(u, {});
    if (!bare) this.resolve(W);
    let y = collideUp(B.rects, W.rects, 0, 14);
    y = Math.min(Number.isFinite(y) ? y : 0, -40);
    const prims = W.prims.length;
    B.merge(W, 0, y);
    for (let i = B.prims.length - prims; i < B.prims.length; i++) {
      if (B.prims[i].kind === 'base') B.prims[i] = { ...B.prims[i], kind: kind === 'loose' ? 'loose' : 'base' };
    }
  }
}
