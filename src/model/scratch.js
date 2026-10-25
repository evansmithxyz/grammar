// Build-from-scratch mode: the learner starts with every word unattached and
// builds the diagram themselves. These are the edits that mode makes, and the
// grading against the parser's answer. All of them return new unit arrays.

import { Graph, RELATIONS, relationChoices } from './graph.js';

/** The answer's units with every word unattached. */
export function blank(units) {
  return units.map((u) => ({ ...u, tokens: [...u.tokens], head: null, rel: 'float' }));
}

/** Ids of the units on the board: each root and everything hanging from it. */
export function attachedIds(units) {
  const kids = new Map();
  for (const u of units) if (u.head != null) {
    if (!kids.has(u.head)) kids.set(u.head, []);
    kids.get(u.head).push(u.id);
  }
  const out = new Set();
  const stack = units.filter((u) => u.rel === 'root' && u.head == null).map((u) => u.id);
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(kids.get(id) || []));
  }
  return out;
}

/** Start a sentence's baseline with this word as its main verb. */
export function makeRoot(units, id) {
  const u = units.find((x) => x.id === id);
  if (!u) return { units };
  if (units.some((x) => x.rel === 'root' && x.head == null && x.sent === u.sent)) {
    return { units, error: 'This sentence already has a main verb. Drag a word onto the word it belongs to.' };
  }
  return { units: units.map((x) => (x.id === id ? { ...x, head: null, rel: 'root' } : x)) };
}

/** Send a word back to the tray, along with everything hanging from it. */
export function detachTree(units, id) {
  const gone = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const u of units) if (u.head != null && gone.has(u.head) && !gone.has(u.id)) { gone.add(u.id); grew = true; }
  }
  return { units: units.map((u) => (gone.has(u.id) ? { ...u, head: null, rel: 'float' } : u)) };
}

/**
 * The jobs to offer when `u` is dropped onto `h`, in a fixed order so the
 * right one isn't given away by being first. The answer's job is always there.
 */
export function jobChoices(work, tokens, id, headId, keyRel) {
  const g = new Graph(tokens, work);
  const u = g.get(id), h = g.get(headId);
  const set = new Set(relationChoices(g, u, h));
  if (g.isVerbal(h)) set.add('npadv');
  if (u.pos === 'INTJ') set.add('intj');
  if (keyRel && keyRel !== 'float' && keyRel !== 'root') set.add(keyRel);
  set.delete('root');
  set.delete('float');
  const order = Object.keys(RELATIONS);
  return [...set].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

// Jobs drawn the same way on the diagram count as the same answer.
const SAME = { npadv: 'mod' };
const norm = (rel) => SAME[rel] || rel;

/**
 * Grade the learner's units against the answer. Returns Map id → 'right' |
 * 'wrong' | 'unplaced'. Compound parts are judged as a group, so building
 * "Mary and John" instead of "John and Mary" still counts, and a conjunction
 * may hang from any part of its compound.
 */
export function grade(work, key, tokens) {
  const gw = new Graph(tokens, work), gk = new Graph(tokens, key);
  const placed = attachedIds(work);

  // every compound is identified by its members, in either graph
  const groupOf = (g) => {
    const first = new Map();
    const top = (u) => { let c = u; for (let n = 0; n < 30 && c.rel === 'conj' && c.head != null; n++) c = g.head(c); return c; };
    for (const u of g.units) first.set(u.id, top(u).id);
    const members = new Map();
    for (const [id, f] of first) {
      if (!members.has(f)) members.set(f, []);
      members.get(f).push(id);
    }
    const name = new Map();
    for (const [id, f] of first) name.set(id, members.get(f).sort().join('+'));
    return { first, name };
  };
  const W = groupOf(gw), K = groupOf(gk);
  // a word's place: which compound it's in, and that compound's job and head compound
  const place = (g, G, u) => {
    const f = g.get(G.first.get(u.id));
    const h = g.head(f);
    return `${G.name.get(u.id)}|${norm(f.rel)}|${h ? G.name.get(h.id) : '-'}`;
  };

  const out = new Map();
  for (const ku of gk.units) {
    const wu = gw.get(ku.id);
    if (!wu || !placed.has(wu.id)) { out.set(ku.id, 'unplaced'); continue; }
    let ok;
    if (ku.rel === 'cc') {
      ok = wu.rel === 'cc' && !!gw.head(wu) && !!gk.head(ku) && W.name.get(gw.head(wu).id) === K.name.get(gk.head(ku).id);
    } else {
      ok = place(gw, W, wu) === place(gk, K, ku);
    }
    out.set(ku.id, ok ? 'right' : 'wrong');
  }
  return out;
}
