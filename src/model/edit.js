// Edits the user can make to a parse. Each takes the current units and
// returns a new array (the old one stays in the undo history).

import { Graph, posOfTokens } from './graph.js';

const clone = (units) => units.map((u) => ({ ...u, tokens: [...u.tokens] }));
const renumber = (units) => {
  const ids = new Map(units.map((u, k) => [u.id, `u${k}`]));
  return units.map((u) => ({ ...u, id: ids.get(u.id), head: u.head == null ? null : ids.get(u.head) ?? null }));
};

/** Move `id` under `headId` with relation `rel`. Refuses cycles. */
export function reattach(units, tokens, id, headId, rel) {
  const g = new Graph(tokens, units);
  const u = g.get(id), h = g.get(headId);
  if (!u || !h || u === h) return { units, error: 'Pick a different word.' };
  if (g.dominates(u, h)) return { units, error: `“${g.text(h)}” hangs from “${g.text(u)}”, so it can’t also be its head.` };
  const out = clone(units);
  const nu = out.find((x) => x.id === id);
  const wasRoot = nu.rel === 'root';
  nu.head = headId;
  nu.rel = rel;
  if (wasRoot) {
    // the word it moved under takes over as the main verb
    const nh = out.find((x) => x.id === headId);
    let top = nh;
    while (top.head) top = out.find((x) => x.id === top.head);
    top.head = null;
    top.rel = 'root';
  }
  return { units: out };
}

export function setRelation(units, tokens, id, rel) {
  const out = clone(units);
  const u = out.find((x) => x.id === id);
  if (!u) return { units };
  if (rel === 'root') {
    const g = new Graph(tokens, units);
    const old = units.find((x) => x.rel === 'root' && x.head == null && x.sent === u.sent);
    u.head = null;
    u.rel = 'root';
    if (old && old.id !== id) {
      const o = out.find((x) => x.id === old.id);
      // the old main verb now hangs from the new one, unless that would loop
      if (!g.dominates(g.get(id), g.get(old.id))) { o.head = id; o.rel = 'conj'; }
      else { o.head = null; o.rel = 'float'; }
    }
    return { units: out };
  }
  u.rel = rel;
  return { units: out };
}

export function detach(units, id) {
  const out = clone(units);
  const u = out.find((x) => x.id === id);
  if (u && u.rel !== 'root') { u.head = null; u.rel = 'float'; }
  return { units: out };
}

/** Join a unit with the unit holding the next token ("New" + "York"). */
export function mergeNext(units, tokens, id) {
  const u = units.find((x) => x.id === id);
  if (!u || !u.tokens.length) return { units, error: 'Nothing to join.' };
  const last = Math.max(...u.tokens);
  const next = units.find((x) => x.tokens.includes(last + 1) && x.sent === u.sent);
  if (!next) return { units, error: 'That’s the last word.' };
  const g = new Graph(tokens, units);
  // the joined word keeps the job of whichever half sits higher in the tree
  // ("brown" + "fox" stays the subject, not a modifier of itself)
  const keep = g.dominates(next, u) || next.rel === 'root' ? next : u;
  const out = clone(units).filter((x) => x.id !== next.id);
  const m = out.find((x) => x.id === id);
  m.tokens = [...m.tokens, ...next.tokens].sort((a, b) => a - b);
  m.pos = posOfTokens(m.tokens, tokens);
  m.head = keep.head;
  m.rel = keep.rel;
  for (const x of out) {
    if (x.head === next.id) x.head = id;
  }
  if (m.head === m.id || m.head === next.id) { m.head = null; m.rel = m.rel === 'root' ? 'root' : 'float'; }
  return { units: renumber(out) };
}

/** Split a multi-word unit into one unit per token. */
export function split(units, tokens, id) {
  const u = units.find((x) => x.id === id);
  if (!u || u.tokens.length < 2) return { units, error: 'That’s already one word.' };
  const out = clone(units);
  const m = out.find((x) => x.id === id);
  // the content word keeps the role; the rest hang from it
  const keep = [...u.tokens].reverse().find((i) => !['AUX', 'MODAL', 'DET', 'PART'].includes(tokens[i].pos)) ?? u.tokens.at(-1);
  m.tokens = [keep];
  m.pos = posOfTokens([keep], tokens);
  for (const i of u.tokens) {
    if (i === keep) continue;
    out.push({ id: `n${i}`, tokens: [i], pos: posOfTokens([i], tokens), head: id, rel: 'mod', sent: u.sent });
  }
  return { units: renumber(out) };
}
