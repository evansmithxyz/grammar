// Turns a spaCy parse (from server/app.py) into the app's sentence model: the
// same { tokens, units } shape the built-in parser produces, so the layout,
// editor and practice mode work unchanged.
//
// spaCy's English models use the ClearNLP dependency labels, which are already
// close to Reed–Kellogg: prepositions head their objects (prep → pobj), linking
// verbs head their complements (attr, acomp), and indirect objects (dative) and
// object complements (oprd) have their own labels. The work here is merging
// helping verbs and particles into their verb, folding possessive 's onto its
// noun, and a few relabels.

import { fillEllipsis } from '../model/ellipsis.js';

const CONTRACTIONS = { "n't": 'not', "'re": 'are', "'m": 'am', "'ll": 'will', "'ve": 'have' };
const WH_TAGS = new Set(['WDT', 'WP', 'WP$', 'WRB']);
const CLAUSE_RELS = new Set(['root', 'advcl', 'relcl', 'conj', 'dobj', 'subj', 'pred']);
const SUBORDINATING_ADVERBS = /^(when|whenever|where|wherever|while|as|once|until|till|because|since|before|after|if|unless|though|although)$/;

/** How a token reads on the diagram: contractions are spelled out. */
function displayText(t) {
  const low = t.text.toLowerCase().replace(/’/g, "'");
  if (low in CONTRACTIONS) return CONTRACTIONS[low];
  if (low === "'s" && t.tag !== 'POS') return t.lemma === 'have' ? 'has' : t.lemma === 'us' ? 'us' : 'is';
  if (low === "'d") return t.lemma === 'have' ? 'had' : 'would';
  if (/^(ca|wo|sha)$/.test(low) && t.tag === 'MD') return t.lemma; // can't, won't, shan't
  return t.text;
}

/** spaCy's tags, collapsed to the parts of speech the rest of the app uses. */
function coarsePos(t) {
  if (t.dep === 'expl') return 'EXPL';
  if (t.tag === 'TO') return 'TO';
  if (t.norm === 'that') return 'THAT';
  if (WH_TAGS.has(t.tag)) return 'WH';
  if (t.tag === 'MD') return 'MODAL';
  if (t.dep === 'neg') return 'NEG';
  if (t.pos === 'AUX') return 'AUX';
  if (t.tag === 'PRP$' || t.possessive) return 'POSS';
  if (t.tag === 'RP') return 'PART';
  const map = {
    NOUN: 'NOUN', PROPN: 'PROPN', PRON: 'PRON', VERB: 'VERB', ADJ: 'ADJ', ADV: 'ADV', DET: 'DET', NUM: 'NUM',
    ADP: 'PREP', CCONJ: 'CCONJ', SCONJ: 'SCONJ', INTJ: 'INTJ', PART: 'ADV',
  };
  return map[t.pos] || 'NOUN';
}

/** The part of speech a whole unit gets, once its job is known. */
function unitPos(tokPos, tag, rel, verbal) {
  if (verbal) return 'VERB';
  if (tokPos === 'THAT' || tokPos === 'WH') {
    if (rel === 'mark') return 'SCONJ';
    if (tag === 'WRB') return 'ADV'; // where, when, why, how
    if (rel === 'mod') return 'DET'; // which book, that book
    return 'PRON';
  }
  if (tokPos === 'EXPL' || tokPos === 'NEG') return 'ADV';
  if (tokPos === 'TO') return rel === 'prep' ? 'PREP' : 'TO';
  return tokPos;
}

const isVerbTok = (t) => t && (t.pos === 'VERB' || t.pos === 'AUX');

/** spaCy (ClearNLP) dependency label → the app's relation. */
function relation(dep, t, head) {
  switch (dep) {
    case 'ROOT': return 'root';
    case 'nsubj': case 'nsubjpass': case 'csubj': case 'csubjpass': return 'subj';
    case 'dobj': return 'dobj';
    case 'dative': return t.pos === 'ADP' ? 'prep' : 'iobj';
    case 'attr': case 'acomp': return 'pred';
    case 'oprd': return 'ocomp';
    case 'prep': case 'agent': return 'prep';
    case 'pobj': case 'pcomp': return 'pobj';
    case 'ccomp': return isVerbTok(head) ? 'dobj' : 'advcl';
    case 'xcomp': return isVerbTok(t) ? 'dobj' : 'pred';
    case 'advcl': return 'advcl';
    case 'relcl': return 'relcl';
    case 'acl': return 'mod';
    case 'appos': return 'appos';
    case 'conj': return 'conj';
    case 'cc': return 'cc';
    case 'mark': return 'mark';
    case 'aux': return 'mark'; // only infinitive "to" gets here; other helpers merge into the verb
    case 'expl': return 'expl';
    case 'intj': return 'intj';
    case 'npadvmod': return 'npadv';
    case 'parataxis': return isVerbTok(t) ? 'conj' : 'mod';
    default: return 'mod'; // det, amod, advmod, nummod, poss, compound, neg, predet, quantmod, nmod, case, dep
  }
}

export function fromSpacy(text, data) {
  const raw = [...(data.tokens || [])].sort((a, b) => a.i - b.i).map((t) => ({ ...t, norm: t.text.toLowerCase() }));
  const byIndex = new Map(raw.map((t) => [t.i, t]));

  // Fold possessive 's onto its noun ("John" + "'s" → "John's"), and drop
  // punctuation and whitespace, re-hanging anything that pointed at them.
  const redirect = new Map();
  const kept = [];
  for (const t of raw) {
    if (t.tag === 'POS' && kept.length && kept.at(-1).end === t.start) {
      const owner = kept.at(-1);
      owner.text += t.text;
      owner.end = t.end;
      owner.possessive = true;
      redirect.set(t.i, owner.i);
      continue;
    }
    if (t.pos === 'PUNCT' || t.pos === 'SPACE' || !t.text.trim()) {
      redirect.set(t.i, t.head);
      continue;
    }
    kept.push(t);
  }
  const resolve = (i) => {
    for (let n = 0; n < 50 && redirect.has(i); n++) {
      const next = redirect.get(i);
      if (next === i) break;
      i = next;
    }
    return i;
  };
  for (const t of kept) {
    t.head = resolve(t.head);
    if (!kept.some((k) => k.i === t.head)) t.head = t.i; // its head was dropped: make it a root
    if (t.head === t.i && t.dep !== 'ROOT') t.dep = 'ROOT';
  }

  // the app's tokens, indexed 0..n-1 across all sentences
  const index = new Map(kept.map((t, k) => [t.i, k]));
  const tokens = kept.map((t, k) => {
    const pos = coarsePos(t);
    return {
      i: k,
      text: displayText(t),
      norm: displayText(t).toLowerCase(),
      lemma: (t.lemma || t.text).toLowerCase(),
      tags: new Set([t.tag, t.pos]),
      start: t.start,
      end: t.end,
      post: t.ws || '',
      pre: '',
      pos,
      sent: t.sent || 0,
    };
  });

  // Group tokens into units: helping verbs and particles join their verb
  // ("has been running", "gave up"); runs of proper nouns join ("New York").
  const parent = kept.map((_, k) => k);
  const find = (k) => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const join = (a, b) => { parent[find(a)] = find(b); };
  kept.forEach((t, k) => {
    const h = byIndex.get(t.head);
    if (!h || t.head === t.i) return;
    const hk = index.get(t.head);
    if (((t.dep === 'aux' || t.dep === 'auxpass') && t.tag !== 'TO') || t.dep === 'prt') join(k, hk);
    else if (t.dep === 'compound' && t.pos === 'PROPN' && h.pos === 'PROPN') join(k, hk);
  });

  const groups = new Map();
  kept.forEach((_, k) => {
    const r = find(k);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(k);
  });

  const units = [];
  const unitOfTok = new Map();
  for (const members of groups.values()) {
    members.sort((a, b) => a - b);
    // the member whose head lies outside the group carries the unit's job
    const anchorK = members.find((k) => {
      const hk = index.get(kept[k].head);
      return hk == null || hk === k || !members.includes(hk);
    }) ?? members[0];
    const t = kept[anchorK];
    const verbal = members.some((k) => isVerbTok(kept[k]) || kept[k].tag === 'MD');
    const unit = { tokens: members, anchor: anchorK, verbal, sent: tokens[anchorK].sent };
    units.push(unit);
    for (const k of members) unitOfTok.set(k, unit);
  }
  units.sort((a, b) => a.tokens[0] - b.tokens[0]);

  for (const u of units) {
    const t = kept[u.anchor];
    const hk = index.get(t.head);
    const headUnit = hk == null || hk === u.anchor ? null : unitOfTok.get(hk);
    u.headRef = headUnit && headUnit !== u ? headUnit : null;
    u.rel = u.headRef ? relation(t.dep, t, kept[headUnit.anchor]) : 'root';
    u.pos = unitPos(tokens[u.anchor].pos, t.tag, u.rel, u.verbal && tokens[u.anchor].pos !== 'THAT' && tokens[u.anchor].pos !== 'WH');
  }

  const kidsOf = (u, rel) => units.filter((k) => k.headRef === u && (!rel || k.rel === rel));

  // spaCy chains coordination ("laughed, sang, and danced": danced hangs from
  // sang); the diagram's forks want every part hanging from the first. But a
  // verb with no subject of its own that's joined to a verb with one ("and he
  // shall nominate, and ... shall appoint") is part of that verb's clause, not
  // of the first clause's.
  const ownSubject = (u) => units.some((k) => k.headRef === u && k.rel === 'subj');
  for (const u of units) {
    if (u.rel !== 'conj') continue;
    for (let n = 0; n < 20 && u.headRef && u.headRef.rel === 'conj' && u.headRef.headRef; n++) {
      if (u.verbal && u.headRef.verbal && ownSubject(u.headRef) && !ownSubject(u)) break;
      u.headRef = u.headRef.headRef;
    }
  }

  for (const u of units) {
    // "There is a cat": the expletive fills the slot; the real subject is the complement
    if (u.verbal && kidsOf(u, 'expl').length && !kidsOf(u, 'subj').length) {
      const real = kidsOf(u, 'pred')[0];
      if (real) real.rel = 'subj';
    }
    // "When the bell rang": spaCy calls "when" an adverb; on the diagram it rides the connector
    if (u.rel === 'advcl' && !kidsOf(u, 'mark').length) {
      const first = units.filter((k) => k.headRef === u && k.rel === 'mod' && k.tokens[0] < u.tokens[0])
        .find((k) => SUBORDINATING_ADVERBS.test(tokens[k.anchor].norm));
      if (first) { first.rel = 'mark'; first.pos = 'SCONJ'; }
    }
    // a conjunction sits with the part it introduces, as the built-in parser
    // does: the next part after it, among the parts joined to its head or to
    // its head's head (spaCy hangs it on the part before)
    if (u.rel === 'cc' && u.headRef) {
      const own = kidsOf(u.headRef, 'conj');
      const up = u.headRef.rel === 'conj' && u.headRef.headRef ? kidsOf(u.headRef.headRef, 'conj') : [];
      const next = (parts) => parts.find((p) => p.tokens[0] > u.tokens[0]);
      const pick = next(own) || next(up) || own.at(-1) || up.at(-1);
      if (pick) u.headRef = pick;
    }
  }

  // relative pronouns point back at the noun the clause modifies
  for (const u of units) {
    if (!/^(WH|THAT)$/.test(tokens[u.anchor].pos) || u.rel === 'mark') continue;
    for (let c = u.headRef, n = 0; c && n < 4; c = c.headRef, n++) {
      if (c.rel === 'relcl') { u.relPron = true; break; }
      if (CLAUSE_RELS.has(c.rel) && c.rel !== 'subj' && c.rel !== 'dobj') break;
    }
  }

  // commands have an understood "you"
  for (const u of units.filter((x) => x.rel === 'root' && x.verbal)) {
    const t = kept[u.anchor];
    const hasSubject = kidsOf(u).some((k) => k.rel === 'subj' || k.rel === 'expl');
    if (!hasSubject && t.tag === 'VB' && !kidsOf(u, 'mark').some((m) => tokens[m.anchor].pos === 'TO')) {
      units.push({
        tokens: [], understood: true, text: 'you', pos: 'PRON', rel: 'subj', headRef: u, sent: u.sent,
        order: Math.min(...u.tokens) - 0.5,
      });
    }
  }

  units.forEach((u, k) => { u.id = `u${k}`; });
  const out = units.map((u) => {
    const o = { id: u.id, tokens: u.tokens, pos: u.pos, rel: u.rel, head: u.headRef ? u.headRef.id : null, sent: u.sent };
    if (u.understood) Object.assign(o, { understood: true, text: u.text, order: u.order });
    if (u.relPron) o.relPron = true;
    return o;
  });
  return { tokens, units: fillEllipsis(tokens, out) };
}
