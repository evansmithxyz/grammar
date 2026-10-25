// The sentence model shared by the parser, the editor and the renderers.
//
// A sentence is a set of *units*: one or more tokens drawn as a single word on
// the diagram ("has been running", "New York"). Every unit points at a head
// unit with a relation, Universal-Dependencies style. The Reed–Kellogg layout
// reads this graph; user edits only ever change head / rel / grouping.

export const RELATIONS = {
  root: { label: 'Main verb', short: 'verb' },
  subj: { label: 'Subject', short: 'subj' },
  dobj: { label: 'Direct object', short: 'dobj' },
  iobj: { label: 'Indirect object', short: 'iobj' },
  pred: { label: 'Subject complement', short: 'pred' },
  ocomp: { label: 'Object complement', short: 'ocomp' },
  mod: { label: 'Modifier', short: 'mod' },
  prep: { label: 'Preposition', short: 'prep' },
  pobj: { label: 'Object of preposition', short: 'pobj' },
  npadv: { label: 'Adverbial noun', short: 'npadv' },
  appos: { label: 'Appositive', short: 'appos' },
  conj: { label: 'Compound part', short: 'conj' },
  cc: { label: 'Conjunction', short: 'cc' },
  mark: { label: 'Subordinator', short: 'mark' },
  advcl: { label: 'Adverb clause', short: 'advcl' },
  relcl: { label: 'Adjective clause', short: 'relcl' },
  expl: { label: 'Expletive', short: 'expl' },
  intj: { label: 'Independent element', short: 'intj' },
  float: { label: 'Unattached', short: '—' },
};

export const VERBAL_POS = new Set(['VERB', 'AUX', 'MODAL']);
export const NOMINAL_POS = new Set(['NOUN', 'PROPN', 'PRON']);

export function unitText(unit, tokens) {
  if (unit.understood) return unit.text;
  const words = unit.tokens.map((i) => tokens[i].text).join(' ');
  // words left out of a reduced clause, like "(are) sitting"
  return unit.implied ? `(${unit.implied}) ${words}` : words;
}

/** Index a list of units for fast lookups. */
export class Graph {
  constructor(tokens, units) {
    this.tokens = tokens;
    this.units = units;
    this.byId = new Map(units.map((u) => [u.id, u]));
    this.kidsOf = new Map();
    for (const u of units) {
      if (u.head == null) continue;
      if (!this.kidsOf.has(u.head)) this.kidsOf.set(u.head, []);
      this.kidsOf.get(u.head).push(u);
    }
    for (const list of this.kidsOf.values()) list.sort((a, b) => this.order(a) - this.order(b));
  }

  get(id) { return this.byId.get(id); }
  text(u) { return unitText(u, this.tokens); }
  order(u) { return u.tokens.length ? Math.min(...u.tokens) : u.order ?? -1; }
  kids(u, ...rels) {
    const all = this.kidsOf.get(u.id) || [];
    return rels.length ? all.filter((k) => rels.includes(k.rel)) : all;
  }
  kid(u, rel) { return this.kids(u, rel)[0] || null; }
  head(u) { return u.head == null ? null : this.byId.get(u.head); }
  isVerbal(u) { return VERBAL_POS.has(u.pos); }

  roots() { return this.units.filter((u) => u.head == null); }

  /** True if `a` is `b` or one of its ancestors. Guards against cycles on edits. */
  dominates(a, b) {
    for (let cur = b, n = 0; cur && n < 500; cur = this.head(cur), n++) if (cur.id === a.id) return true;
    return false;
  }

  /** Plain-English description of what a unit does in the sentence. */
  describe(u) {
    const h = this.head(u);
    const ht = h ? `“${this.text(h)}”` : '';
    switch (u.rel) {
      case 'root': return 'the main verb (simple predicate)';
      case 'subj': return `the subject of ${ht}`;
      case 'dobj': return `the direct object of ${ht}`;
      case 'iobj': return `the indirect object of ${ht}`;
      case 'pred':
        return NOMINAL_POS.has(u.pos) ? `a predicate noun renaming the subject of ${ht}` : `a predicate adjective describing the subject of ${ht}`;
      case 'ocomp': return `an object complement after ${ht}`;
      case 'mod': {
        if (u.pos === 'VERB' && this.kid(u, 'mark')) return `an infinitive phrase modifying ${ht}`;
        if (u.pos === 'VERB') return `a participle modifying ${ht}`;
        const adverbial = h && (this.isVerbal(h) || h.pos === 'ADJ' || h.pos === 'ADV');
        return adverbial ? `an adverb modifying ${ht}` : `an adjective modifying ${ht}`;
      }
      case 'prep': return `a preposition starting a phrase that modifies ${ht}`;
      case 'pobj': return `the object of the preposition ${ht}`;
      case 'npadv': return `a noun working as an adverb on ${ht}`;
      case 'appos': return `an appositive renaming ${ht}`;
      case 'conj': return `joined to ${ht} in a compound`;
      case 'cc': return `a conjunction joining a compound with ${ht}`;
      case 'mark': return `introduces the clause built on ${ht}`;
      case 'advcl': return `the verb of an adverb clause modifying ${ht}`;
      case 'relcl': return `the verb of an adjective clause modifying ${ht}`;
      case 'expl': return 'an expletive that fills the subject slot';
      case 'intj': return 'an independent element, grammatically apart from the rest';
      default: return 'not attached to anything yet — drag it onto a word';
    }
  }
}

/** Relations that make sense for `u` hanging from `h`, best guess first. */
export function relationChoices(g, u, h) {
  if (!h) return ['root', 'intj', 'float'];
  const hv = g.isVerbal(h);
  const choices = [];
  if (isPrepLike(h)) choices.push('pobj');
  if (hv) {
    if (NOMINAL_POS.has(u.pos) || u.pos === 'VERB') choices.push('subj', 'dobj', 'iobj', 'pred', 'ocomp', 'npadv');
    if (u.pos === 'ADJ') choices.push('pred', 'ocomp');
    if (u.pos === 'VERB') choices.push('advcl', 'conj');
  }
  if (isPrepLike(u)) choices.push('prep');
  choices.push('mod');
  if (NOMINAL_POS.has(u.pos) && NOMINAL_POS.has(h.pos)) choices.push('appos');
  if (u.pos === 'VERB' && NOMINAL_POS.has(h.pos)) choices.push('relcl');
  if (u.pos === 'CCONJ') choices.unshift('cc');
  if (u.pos === 'SCONJ' || u.pos === 'THAT' || u.pos === 'TO' || u.pos === 'WH') choices.push('mark');
  choices.push('conj');
  return [...new Set(choices)];
}

/**
 * A preposition by part of speech, or by job: spaCy tags "except" and
 * "because" as conjunctions even when they head a phrase.
 */
const isPrepLike = (u) => u.pos === 'PREP' || u.pos === 'TO' || u.rel === 'prep';

/** Best relation to use when a unit is dropped onto a new head. */
export function guessRelation(g, u, h) {
  if (u.pos === 'CCONJ') return 'cc';
  if (isPrepLike(h)) return 'pobj';
  if (isPrepLike(u)) return 'prep';
  if (g.isVerbal(h) && (NOMINAL_POS.has(u.pos) || u.pos === 'VERB')) {
    // keep a nominal role if it already had one
    if (['subj', 'dobj', 'iobj', 'pred', 'ocomp', 'npadv'].includes(u.rel)) return u.rel;
    if (!g.kid(h, 'subj')) return 'subj';
    if (!g.kid(h, 'dobj')) return 'dobj';
    return 'npadv';
  }
  if (g.isVerbal(h) && u.pos === 'ADJ' && u.rel === 'pred') return 'pred';
  if (NOMINAL_POS.has(u.pos) && NOMINAL_POS.has(h.pos) && u.rel === 'appos') return 'appos';
  return 'mod';
}

/** Serialize units compactly for URLs: [tokens, head index, rel, understood text]. */
export function encodeUnits(units) {
  const idx = new Map(units.map((u, k) => [u.id, k]));
  return units.map((u) => {
    const row = [u.tokens, u.head == null ? -1 : idx.get(u.head), u.rel];
    if (u.understood || u.implied) row.push(u.understood ? u.text : null, u.understood ? u.order ?? 0 : null);
    if (u.implied) row.push(u.implied);
    return row;
  });
}

export function decodeUnits(rows, tokens) {
  const units = rows.map((r, k) => ({
    id: `u${k}`,
    tokens: r[0],
    rel: r[2],
    head: null,
    pos: r[3] != null ? 'PRON' : posOfTokens(r[0], tokens),
    understood: r[3] != null,
    text: r[3] ?? null,
    order: r[4] ?? undefined,
    implied: r[5] ?? undefined,
    sent: r[0].length ? tokens[r[0][0]].sent : 0,
  }));
  rows.forEach((r, k) => { if (r[1] >= 0) units[k].head = `u${r[1]}`; });
  return units;
}

/** The part of speech a multi-token unit gets is its content word's. */
export function posOfTokens(idxs, tokens) {
  const ts = idxs.map((i) => tokens[i]);
  const content = ts.findLast((t) => !['AUX', 'MODAL', 'DET', 'PART', 'NEG'].includes(t.pos)) || ts.at(-1);
  if (ts.some((t) => ['AUX', 'MODAL'].includes(t.pos)) && !content) return 'VERB';
  if (content && ['AUX', 'MODAL'].includes(content.pos)) return 'VERB';
  return content ? content.pos : 'NOUN';
}
