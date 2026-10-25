import { tagText, isGerund, isBeForm } from './tagger.js';
import {
  CLAUSE_VERBS, INFINITIVE_VERBS, GERUND_VERBS, LINKING_VERBS, NOMINAL_LINKING,
  OBJ_COMPLEMENT_VERBS, ADVERBIAL_NOUNS, SUBORDINATORS, SUBJECT_PRONOUNS,
  BE_FORMS, HAVE_FORMS, DO_FORMS, MODALS, REDUCING, POSTPOSITIVE, INFINITIVE_NOUNS,
} from './lexicon.js';
import { posOfTokens } from '../model/graph.js';
import { fillEllipsis } from '../model/ellipsis.js';

/**
 * Parse text into tokens and a dependency graph of units.
 * This is a heuristic, rule-based parser: it handles the sentence patterns a
 * grammar class diagrams (compound parts, objects, complements, phrases,
 * clauses, questions, imperatives) and leaves the rest attached somewhere
 * sensible so the user can drag it into place.
 */
export function parse(text) {
  const sentences = tagText(text);
  const tokens = [];
  const units = [];
  sentences.forEach((s, si) => {
    for (const t of s.tokens) { t.sent = si; tokens.push(t); }
  });
  sentences.forEach((s, si) => {
    const question = /\?/.test(s.end + (s.tokens.at(-1)?.post || ''));
    let best = parseSentence(s.tokens, si, question);
    // Compromise sometimes tags a verb as a noun ("my cat sleep", "To err").
    // If the parse came out without a main verb, try re-tagging candidates.
    if (best.score < 10) {
      for (let k = 1; k < s.tokens.length; k++) {
        const t = s.tokens[k], prev = s.tokens[k - 1];
        if (t.pos !== 'NOUN' || /DET|POSS|ADJ|NUM/.test(prev.pos)) continue;
        const saved = { pos: t.pos, tags: new Set(t.tags) };
        t.pos = 'VERB';
        t.tags.add('Verb'); t.tags.add('PresentTense'); t.tags.add('Infinitive');
        const alt = parseSentence(s.tokens, si, question);
        if (alt.score > best.score) best = alt;
        else { t.pos = saved.pos; t.tags = saved.tags; }
        if (best.score >= 10) break;
      }
    }
    units.push(...best.units);
  });
  units.forEach((u, k) => { u.id = `u${k}`; });
  // re-point heads from object references to ids
  for (const u of units) u.head = u.headRef ? u.headRef.id : null;
  for (const u of units) delete u.headRef;
  return { tokens, units: fillEllipsis(tokens, units) };
}

const PRONOUN_DETS = new Set('this these those some any all both each either neither many few several none much another such most enough'.split(' '));
function parseSentence(tokens, si, question) {
  const units = [];
  new SentenceParser(tokens, units, si, question).run();
  const root = units.find((u) => u.rel === 'root');
  const floats = units.filter((u) => u.rel === 'float').length;
  // a conjunction with nothing on the other side means something went wrong
  const dangling = units.filter((u) => u.rel === 'cc' && !units.some((k) => k.rel === 'conj' && (k.headRef === u.headRef || k === u.headRef || k.headRef === u))).length;
  const score = (root && root.pos === 'VERB' ? 10 : 0) - (floats + dangling) * 3 + (root ? 1 : 0);
  return { units, score };
}

const NP_START = new Set(['DET', 'POSS', 'ADJ', 'NUM', 'NOUN', 'PROPN', 'PRON']);
const AUXISH = (t) => t && (t.pos === 'AUX' || t.pos === 'MODAL');

class SentenceParser {
  constructor(toks, units, si, question) {
    this.t = toks;
    this.n = toks.length;
    this.units = units;
    this.si = si;
    this.question = question;
    this.unitOfTok = new Map();
  }

  // ---------- tokens ----------
  tok(j) { return this.t[j]; }
  pos(j) { return this.t[j]?.pos; }
  norm(j) { return this.t[j]?.norm; }
  comma(j) { return /[,;:—–]/.test(this.t[j]?.post || ''); }
  semi(j) { return /;/.test(this.t[j]?.post || ''); }

  // ---------- units ----------
  unit(idxs, pos) {
    const tokIdx = idxs.map((j) => this.t[j].i);
    const u = {
      tokens: tokIdx,
      pos: pos || posOfTokens(tokIdx, Object.fromEntries(idxs.map((j) => [this.t[j].i, this.t[j]]))),
      rel: null,
      headRef: null,
      sent: this.si,
    };
    this.units.push(u);
    for (const j of idxs) this.unitOfTok.set(j, u);
    return u;
  }
  understood(text, beforeJ) {
    const u = { tokens: [], pos: 'PRON', rel: null, headRef: null, understood: true, text, sent: this.si,
      order: (this.t[beforeJ]?.i ?? this.t.at(-1).i) - 0.5 };
    this.units.push(u);
    return u;
  }
  attach(u, head, rel) { if (u) { u.headRef = head; u.rel = rel; } return u; }

  mark() { return this.units.length; }
  rollback(m) {
    while (this.units.length > m) {
      const u = this.units.pop();
      for (const [j, v] of this.unitOfTok) if (v === u) this.unitOfTok.delete(j);
    }
  }

  // ---------- lookahead (no side effects) ----------
  /** End index of a plain noun phrase starting at j, or -1. */
  skipNP(j) {
    let k = j, head = false;
    while (k < this.n) {
      const p = this.pos(k);
      // inside a noun phrase a comma only separates adjectives ("a long, cold winter")
      if (k > j && this.comma(k - 1) && p !== 'ADJ') break;
      if (p === 'PRON' && !head) { k++; head = true; break; }
      if (p === 'NOUN' || p === 'PROPN') { k++; head = true; if (!/NOUN|PROPN/.test(this.pos(k) || '') || this.comma(k - 1)) break; continue; }
      if (p === 'NUM' && !/NOUN|PROPN|ADJ|NUM/.test(this.pos(k + 1) || '')) { k++; head = true; break; }
      if (p === 'DET' || p === 'POSS' || p === 'NUM' || p === 'ADJ') { k++; continue; }
      if (p === 'THAT' && /NOUN|ADJ|PROPN/.test(this.pos(k + 1) || '')) { k++; continue; }
      if (p === 'ADV' && /ADJ|ADV/.test(this.pos(k + 1) || '')) { k++; continue; }
      if (isGerund(this.tok(k)) && !head && k === j) { k++; head = true; break; }
      break;
    }
    if (!head && this.pos(j) === 'THAT') return j + 1; // demonstrative pronoun
    if (!head && this.pos(j) === 'DET' && k === j + 1) return j + 1; // "this", "some"
    return head ? k : -1;
  }

  isVerbStart(j) {
    const p = this.pos(j);
    return p === 'AUX' || p === 'MODAL' || (p === 'VERB' && !isGerund(this.tok(j)));
  }

  /** Does a full clause (subject + finite verb) start at j? */
  clauseAt(j) {
    if (j >= this.n) return false;
    if (this.pos(j) === 'EXPL') return true;
    let e = this.skipNP(j);
    if (e < 0 || this.comma(e - 1)) return false;
    // "the man in the hat (left)": skip phrases hanging on the subject
    for (let guard = 0; guard < 4 && this.pos(e) === 'PREP' && !SUBORDINATORS.has(this.norm(e)); guard++) {
      const e2 = this.skipNP(e + 1);
      if (e2 < 0 || this.comma(e2 - 1)) break;
      e = e2;
    }
    while (/ADV|NEG/.test(this.pos(e) || '')) e++;
    if (this.isVerbStart(e)) return true;
    // "the team that had trained all year (drove)": a relative clause, then the verb
    if ((this.pos(e) === 'WH' && /^(who|which|whose)$/.test(this.norm(e))) || this.pos(e) === 'THAT') {
      let groups = 0;
      for (let k = e + 1; k < this.n; k++) {
        if (this.isVerbStart(k) && !this.isVerbStart(k - 1) && !/ADV|NEG/.test(this.pos(k - 1))) groups++;
        if (this.comma(k) || this.pos(k + 1) === 'CCONJ' || this.pos(k + 1) === 'SCONJ') break;
      }
      return groups >= 2;
    }
    return false;
  }

  // ---------- phrases ----------

  /** Noun phrase without post-modifiers. Returns head unit + end, or null. */
  np(j) {
    const start = j;
    const pre = []; // token indexes of premodifiers
    let headIdx = [];
    while (j < this.n) {
      const p = this.pos(j);
      const nx = this.pos(j + 1);
      if (j > start && this.comma(j - 1) && p !== 'ADJ') break;
      if (!pre.length && (p === 'THAT' || (p === 'DET' && PRONOUN_DETS.has(this.norm(j)))) && !/NOUN|ADJ|PROPN|NUM/.test(nx || '')) {
        return { head: this.unit([j], 'PRON'), end: j + 1, start };
      }
      if (p === 'NUM' && !/NOUN|PROPN|ADJ|NUM/.test(nx || '')) { headIdx = [j++]; break; }
      if (p === 'DET' || p === 'POSS' || p === 'NUM') { pre.push(j++); continue; }
      if ((p === 'THAT' || (p === 'WH' && /which|what|whose/.test(this.norm(j)))) && /NOUN|ADJ|PROPN|NUM/.test(nx || '')) { pre.push(j++); continue; }
      if (p === 'ADV' && (nx === 'ADJ' || nx === 'NUM' || (nx === 'ADV' && this.pos(j + 2) === 'ADJ')) && j + 1 < this.n) {
        // only an NP premodifier if a noun eventually follows
        if (this.skipNP(j) > 0 && /NOUN|PROPN/.test(this.pos(this.skipNP(j) - 1))) { pre.push(j++); continue; }
        break;
      }
      if (p === 'ADJ') {
        const e = this.skipNP(j);
        if (e > j && /NOUN|PROPN/.test(this.pos(e - 1))) { pre.push(j++); continue; }
        if (nx === 'CCONJ' && this.pos(j + 2) === 'ADJ') { pre.push(j++); pre.push(j++); continue; }
        break;
      }
      if (p === 'CCONJ' && pre.length && this.pos(pre.at(-1)) === 'ADJ' && nx === 'ADJ') { pre.push(j++); continue; }
      if (p === 'VERB' && (this.tok(j).tags.has('Gerund') || this.tok(j).tags.has('Participle') || this.tok(j).tags.has('PastTense'))
        && pre.length && /NOUN/.test(nx || '')) { pre.push(j++); continue; } // "the running water"
      if (p === 'NOUN' || p === 'PROPN') {
        // compound nouns: last noun is the head; proper-noun runs stay together
        if (p === 'PROPN') {
          headIdx = [j++];
          while (this.pos(j) === 'PROPN' && !this.comma(j - 1)) headIdx.push(j++);
          if (this.pos(j) === 'NOUN' && !this.comma(j - 1)) { pre.push(...headIdx); headIdx = []; continue; }
          break;
        }
        if (/NOUN|PROPN/.test(nx || '') && !this.comma(j)) { pre.push(j++); continue; }
        headIdx = [j++];
        break;
      }
      if (p === 'PRON' && !pre.length) { headIdx = [j++]; break; }
      if (isGerund(this.tok(j)) && pre.length) { headIdx = [j++]; break; } // "the swimming"
      break;
    }
    if (!headIdx.length) {
      // a lone demonstrative / quantifier works as a pronoun
      if (pre.length === 1 && /THAT|DET/.test(this.pos(pre[0])) && !/ADJ|NOUN/.test(this.pos(pre[0] + 1) || '')) {
        const u = this.unit([pre[0]], 'PRON');
        return { head: u, end: pre[0] + 1 };
      }
      return null;
    }
    const head = this.unit(headIdx, this.pos(headIdx[0]) === 'VERB' ? 'NOUN' : undefined);
    this.premods(pre, head);
    return { head, end: j, start };
  }

  /** Attach a run of premodifiers (det/adj/adv/noun) to a head. */
  premods(pre, head) {
    let lastAdj = null, pendingCC = null, advQueue = [];
    for (const j of pre) {
      const p = this.pos(j);
      if (p === 'ADV') { advQueue.push(this.unit([j], 'ADV')); continue; }
      if (p === 'CCONJ') { pendingCC = this.unit([j], 'CCONJ'); continue; }
      const u = this.unit([j], p === 'THAT' || p === 'WH' ? 'DET' : p === 'VERB' ? 'ADJ' : undefined);
      for (const a of advQueue) this.attach(a, u, 'mod');
      advQueue = [];
      if (pendingCC && lastAdj && p === 'ADJ') {
        this.attach(u, lastAdj, 'conj');
        this.attach(pendingCC, u, 'cc');
        pendingCC = null;
        continue;
      }
      this.attach(u, head, 'mod');
      if (p === 'ADJ') lastAdj = u;
    }
    for (const a of advQueue) this.attach(a, head, 'mod');
    if (pendingCC) this.attach(pendingCC, head, 'mod');
  }

  /**
   * Noun phrase with compounds ("Tom, Ann, and I") and post-modifiers
   * (of-phrases, relative clauses, participial phrases, appositives).
   * ctx: 'subject' | 'object' | 'pobj'
   */
  npc(j, ctx, verbLemma) {
    const first = this.nominal(j, ctx, verbLemma);
    if (!first) return null;
    const items = [first];
    let end = first.end;
    for (;;) {
      // ", B" (list) or "[,] and B"
      let k = end, cc = null;
      if (this.pos(k) === 'CCONJ' && this.norm(k) !== 'so' && this.norm(k) !== 'yet') { cc = k; k++; }
      else if (this.comma(end - 1) && this.pos(k) === 'CCONJ') { cc = k; k++; }
      else if (this.comma(end - 1) && items.length >= 1 && this.listAhead(k)) { /* list continues */ }
      else break;
      if (ctx !== 'subject' && this.clauseAt(k)) break; // "I like tea and she likes coffee"
      if (cc != null && ctx !== 'subject' && this.tok(k)?.verbish) break; // "stay home and play games"
      if (cc != null && SUBJECT_PRONOUNS.has(this.norm(k)) && ctx !== 'subject') break;
      const m = this.mark();
      const next = this.nominal(k, ctx, verbLemma);
      if (!next) { this.rollback(m); break; }
      const ccUnit = cc != null ? this.unit([cc], 'CCONJ') : null;
      this.attach(next.head, first.head, 'conj');
      if (ccUnit) this.attach(ccUnit, next.head, 'cc');
      items.push(next);
      end = next.end;
      if (cc != null) break;
    }
    return { head: first.head, end, items };
  }

  /** Is there a noun phrase at k followed by a comma or a coordinator (a list)? */
  listAhead(k) {
    const e = this.skipNP(k);
    if (e < 0) return false;
    return this.comma(e - 1) || this.pos(e) === 'CCONJ';
  }

  /** One nominal: a noun phrase, gerund phrase or infinitive, plus post-modifiers. */
  nominal(j, ctx, verbLemma) {
    if (isGerund(this.tok(j))) return this.verbal(j, 'gerund');
    if (this.pos(j) === 'TO' && this.isVerbStart(j + 1) && ctx === 'subject') return this.verbal(j, 'infinitive');
    const np = this.np(j);
    if (!np) return null;
    let end = this.postmods(np.head, np.end, ctx, verbLemma);
    return { head: np.head, end };
  }

  postmods(head, j, ctx, verbLemma) {
    for (let guard = 0; guard < 12 && j < this.n; guard++) {
      const p = this.pos(j);
      const prevComma = this.comma(j - 1);
      // of-phrases always hang on the noun; in subject position any phrase does
      if ((p === 'PREP' || (p === 'TO' && !this.isVerbStart(j + 1))) && !prevComma) {
        const isSub = SUBORDINATORS.has(this.norm(j)) && this.clauseAt(j + 1);
        if (!isSub && (this.norm(j) === 'of' || ctx === 'subject')) {
          // "the house in which I live"
          if (/which|whom/.test(this.norm(j + 1) || '')) { j = this.relative(head, j); continue; }
          const pp = this.pp(j, 'pobj');
          if (pp) { this.attach(pp.prep, head, 'prep'); j = pp.end; continue; }
        }
        if (p === 'PREP' && /which|whom/.test(this.norm(j + 1) || '') && !isSub) { j = this.relative(head, j); continue; }
        break;
      }
      // relative clauses
      if ((p === 'WH' && /^(who|whom|whose|which)$/.test(this.norm(j))) || (p === 'THAT' && this.relThatOK(head, j, verbLemma))) {
        const e = this.relative(head, j);
        if (e > j) { j = e; continue; }
        break;
      }
      // participial phrase in subject position: "The dog barking at the cat is mine"
      const tg = this.tok(j).tags;
      if (ctx === 'subject' && p === 'VERB' && !prevComma && head.pos !== 'PRON' && this.laterFiniteVerb(j + 1)
        && (tg.has('Gerund') || ((tg.has('Participle') || tg.has('PastTense')) && /PREP|ADV|TO/.test(this.pos(j + 1) || '')))) {
        const v = this.verbal(j, 'participle');
        this.attach(v.head, head, 'mod');
        j = v.end;
        continue;
      }
      // reduced relative: "The book I read was boring"
      if (ctx === 'subject' && !prevComma && NP_START.has(p) && this.clauseAt(j) && this.laterFiniteVerb(this.skipNP(j) + 1)) {
        const e = this.relative(head, j, true);
        if (e > j) { j = e; continue; }
      }
      // "the Members present"
      if (p === 'ADJ' && !prevComma && POSTPOSITIVE.has(this.norm(j)) && !/NOUN|PROPN/.test(this.pos(j + 1) || '')) {
        this.attach(this.unit([j], 'ADJ'), head, 'mod');
        j++;
        continue;
      }
      // appositive: "My brother, a doctor, ..."
      if (prevComma && NP_START.has(p) && p !== 'ADJ' && !this.clauseAt(j)) {
        const e = this.skipNP(j);
        if (e > 0 && (this.comma(e - 1) || e >= this.n) && !(this.pos(e) === 'CCONJ') && !this.listAhead(e)) {
          const np = this.np(j);
          if (np) { this.attach(np.head, head, 'appos'); j = this.postmods(np.head, np.end, 'pobj'); continue; }
        }
      }
      break;
    }
    return j;
  }

  relThatOK(head, j, verbLemma) {
    // "told her that he left" -> noun clause; "the book that I read" -> relative
    if (verbLemma && CLAUSE_VERBS.has(verbLemma) && head.pos === 'PRON') return false;
    return true;
  }

  laterFiniteVerb(j) {
    for (let k = j; k < this.n; k++) {
      if (this.pos(k) === 'CCONJ' || this.pos(k) === 'SCONJ') return false;
      if (this.comma(k - 1)) return false;
      if (this.isVerbStart(k) && !(this.pos(k) === 'VERB' && this.tok(k).tags.has('Gerund'))) return true;
    }
    return false;
  }

  /** Relative clause hanging off `head`, starting at j. Returns end index. */
  relative(head, j, reduced = false) {
    const m = this.mark();
    let relUnit = null, frontPrep = null, start = j;
    if (reduced) {
      relUnit = this.understood('that', j);
    } else if (this.pos(j) === 'PREP') {
      // "in which"
      frontPrep = this.unit([j], 'PREP');
      relUnit = this.unit([j + 1], 'PRON');
      this.attach(relUnit, frontPrep, 'pobj');
      start = j + 2;
    } else if (this.norm(j) === 'whose') {
      const np = this.np(j);
      if (!np) { this.rollback(m); return j; }
      relUnit = np.head;
      start = np.end;
      relUnit.relPron = true;
      const c = this.isVerbStart(start) ? this.clause(start, { subject: relUnit }) : this.clause(start, {});
      if (!c || !c.verb) { this.rollback(m); return j; }
      if (!this.isVerbStart(start)) this.assignFronted(c.verb, relUnit, c);
      this.attach(c.verb, head, 'relcl');
      // mark the word that points back at the antecedent
      for (const k of this.units) if (k.headRef === relUnit && this.t.find((t) => t.i === k.tokens[0])?.norm === 'whose') k.relPron = true;
      return c.end;
    } else {
      relUnit = this.unit([j], 'PRON');
      start = j + 1;
    }
    relUnit.relPron = true;
    let c;
    if (!frontPrep && !reduced && this.isVerbStart(start)) c = this.clause(start, { subject: relUnit });
    else c = this.clause(start, {});
    if (!c || !c.verb) { this.rollback(m); return j; }
    if (frontPrep) this.attach(frontPrep, c.verb, 'prep');
    else if (!c.subjectWas || c.subjectWas !== relUnit) this.assignFronted(c.verb, relUnit, c);
    this.attach(c.verb, head, 'relcl');
    return c.end;
  }

  /** Prepositional phrase at j. */
  pp(j) {
    const prep = this.unit([j], 'PREP');
    let k = j + 1;
    if (k >= this.n) return { prep, end: k, stranded: true };
    const m = this.mark();
    const obj = this.npc(k, 'pobj');
    if (!obj) {
      this.rollback(m);
      return { prep, end: k, stranded: true };
    }
    this.attach(obj.head, prep, 'pobj');
    return { prep, end: obj.end };
  }

  /** Adjective phrase: (adv)* adj ((,|and) adj)* */
  adjp(j) {
    const advs = [];
    while (this.pos(j) === 'ADV' || this.pos(j) === 'NEG') advs.push(j++);
    if (this.pos(j) !== 'ADJ' && !(this.pos(j) === 'VERB' && this.tok(j).tags.has('Participle'))) return null;
    const head = this.unit([j++], 'ADJ');
    for (const a of advs) this.attach(this.unit([a], 'ADV'), head, 'mod');
    while ((this.pos(j) === 'CCONJ' || this.comma(j - 1)) && (this.pos(j + (this.pos(j) === 'CCONJ' ? 1 : 0)) === 'ADJ')) {
      let cc = null;
      if (this.pos(j) === 'CCONJ') cc = this.unit([j++], 'CCONJ');
      const a = this.unit([j++], 'ADJ');
      this.attach(a, head, 'conj');
      if (cc) this.attach(cc, a, 'cc');
    }
    return { head, end: j };
  }

  /**
   * Verb group: auxiliaries + main verb + particle. Adverbs and negation
   * inside it become modifiers. Returns { verb, end, lemma, linking, auxOnly }.
   */
  vg(j, extraFront = []) {
    const vt = [...extraFront];
    const mods = [];
    let k = j;
    while (k < this.n) {
      const p = this.pos(k);
      if (p === 'AUX' || p === 'MODAL') {
        vt.push(k++);
        continue;
      }
      if ((p === 'NEG' || p === 'ADV') && vt.length && this.verbAhead(k + 1)) { mods.push(k++); continue; }
      if (p === 'VERB') {
        // a gerund after a non-be auxiliary is not part of the group
        if (isGerund(this.tok(k)) && vt.length && !isBeForm(this.tok(vt.at(-1)))) break;
        vt.push(k++);
        // "has" "been" "running" -> keep going only through auxiliaries
        if (this.pos(k) === 'PART') vt.push(k++);
        break;
      }
      break;
    }
    if (!vt.length) return null;
    // A trailing run of only auxiliaries means the last one is the main verb.
    const mainTok = this.tok(vt.findLast((x) => this.pos(x) !== 'PART') ?? vt.at(-1));
    const verb = this.unit(vt, 'VERB');
    for (const mj of mods) this.attach(this.unit([mj], this.pos(mj) === 'NEG' ? 'ADV' : 'ADV'), verb, 'mod');
    let lemma = mainTok.lemma;
    if (BE_FORMS.has(mainTok.norm)) lemma = 'be';
    else if (HAVE_FORMS.has(mainTok.norm)) lemma = 'have';
    else if (DO_FORMS.has(mainTok.norm)) lemma = 'do';
    const auxOnly = vt.every((x) => AUXISH(this.tok(x)));
    return { verb, end: k, lemma, linking: LINKING_VERBS.has(lemma), nominalLinking: NOMINAL_LINKING.has(lemma), auxOnly };
  }

  isVerbalUnit(u) { return u.pos === 'VERB'; }

  verbAhead(k) {
    while (this.pos(k) === 'ADV' || this.pos(k) === 'NEG') k++;
    return this.pos(k) === 'VERB' || AUXISH(this.tok(k));
  }

  /**
   * Gerund, infinitive or participial phrase: the verb plus its own objects
   * and modifiers. kind: 'gerund' | 'infinitive' | 'participle'
   */
  verbal(j, kind) {
    let to = null;
    if (kind === 'infinitive') to = j++;
    const v = this.vg(j);
    if (!v) return null;
    if (to != null) this.attach(this.unit([to], 'TO'), v.verb, 'mark');
    const end = this.predicate(v, v.end, { nonfinite: true });
    return { head: v.verb, end };
  }

  // ---------- clauses ----------

  /**
   * Clause at j. opts.subject presets the subject (relative pronouns).
   * Returns { verb, end, subjectWas } or null.
   */
  clause(j, opts = {}) {
    const fronted = [];
    let subject = opts.subject || null;
    let verbInfo = null;
    let wh = null;
    let expl = null;
    const start = j;

    // fronted adverbs, phrases and subordinate clauses
    for (let guard = 0; guard < 6 && j < this.n && !subject; guard++) {
      const p = this.pos(j);
      if (REDUCING.has(this.norm(j)) && this.reducedAt(j + 1)) {
        const sub = this.reduced(j);
        if (sub && (this.comma(sub.end - 1) || this.clauseAt(sub.end))) { fronted.push([sub.verb, 'advcl']); j = sub.end; continue; }
      }
      if ((p === 'SCONJ' || (p === 'PREP' && SUBORDINATORS.has(this.norm(j))) || (p === 'WH' && /^(when|where|whenever|wherever)$/.test(this.norm(j)) && j !== start))
        && this.clauseAt(j + 1)) {
        const sub = this.subordinate(j);
        if (sub) { fronted.push([sub.verb, 'advcl']); j = sub.end; continue; }
      }
      if (p === 'WH' && /^(when|where|whenever|wherever)$/.test(this.norm(j)) && this.clauseAt(j + 1) && !this.question) {
        const sub = this.subordinate(j);
        if (sub) { fronted.push([sub.verb, 'advcl']); j = sub.end; continue; }
      }
      if (p === 'ADV' && !this.verbAhead(j + 1) && !(this.pos(j + 1) === 'ADJ')) {
        fronted.push([this.unit([j], 'ADV'), 'mod']); j++; continue;
      }
      if (p === 'ADV' && this.isVerbStart(j + 1) && this.pos(j + 1) === 'VERB') { // "Quickly run!" / "Never give up"
        break;
      }
      if (p === 'PREP' || (p === 'TO' && !this.isVerbStart(j + 1))) {
        const m = this.mark();
        const pp = this.pp(j);
        if (!pp.stranded && (this.comma(pp.end - 1) || this.clauseAt(pp.end))) { fronted.push([pp.prep, 'prep']); j = pp.end; continue; }
        this.rollback(m);
        break;
      }
      if (NP_START.has(p) && !opts.subordinate) {
        // "Yesterday we left." / "Last night, we danced."
        const e = this.skipNP(j);
        const headTok = this.tok(e - 1);
        if (e > 0 && headTok && (ADVERBIAL_NOUNS.has(headTok.norm) || headTok.tags.has('Date')) && (this.comma(e - 1) || this.clauseAt(e))) {
          const np = this.np(j);
          if (np) { fronted.push([np.head, 'npadv']); j = np.end; continue; }
        }
      }
      break;
    }

    if (!subject) {
      const p = this.pos(j);
      if (p === 'EXPL') {
        expl = this.unit([j], 'ADV');
        j++;
        verbInfo = this.vg(j);
      } else if (p === 'WH' && !opts.subordinate) {
        // fronted question word: "What did you see?" / "Who saw you?"
        const whNP = /which|what|whose/.test(this.norm(j)) && /NOUN|ADJ/.test(this.pos(j + 1) || '') ? this.np(j) : null;
        wh = whNP ? whNP.head : this.unit([j], /where|when|why|how/.test(this.norm(j)) ? 'ADV' : 'PRON');
        j = whNP ? whNP.end : j + 1;
        if (wh.pos === 'ADV' && this.pos(j) === 'ADJ' || (wh.pos === 'ADV' && this.pos(j) === 'ADV')) {
          // "How old are you?" -> how modifies old
          const a = this.unit([j++], this.pos(j - 1));
          this.attach(wh, a, 'mod');
          wh = a;
        }
        if (AUXISH(this.tok(j)) && this.question && (NP_START.has(this.pos(j + 1)) || this.pos(j + 1) === 'THAT') && this.skipNP(j + 1) > 0) {
          const aux = j;
          const s = this.npc(j + 1, 'subject');
          subject = s.head;
          j = s.end;
          verbInfo = this.isVerbStart(j) && this.pos(j) === 'VERB' ? this.vg(j, [aux]) : this.vg(aux);
          if (verbInfo && verbInfo.end <= j) verbInfo.end = Math.max(verbInfo.end, j);
          if (verbInfo && this.unitOfTok.get(aux) && verbInfo.verb.tokens.length === 1 && verbInfo.verb.tokens[0] === this.tok(aux).i) verbInfo.end = j;
        } else if (this.clauseAt(j)) {
          // embedded: "(I know) what you did"
          const s = this.npc(j, 'subject');
          subject = s.head;
          j = s.end;
        } else if (this.isVerbStart(j)) {
          subject = wh;
          wh = null;
          verbInfo = this.vg(j);
        }
      } else if (AUXISH(this.tok(j)) && this.question && j === start && this.skipNP(j + 1) > 0) {
        // yes/no question: "Did you see the dog?" / "Is she happy?"
        const aux = j;
        const s = this.npc(j + 1, 'subject');
        subject = s.head;
        j = s.end;
        if (this.pos(j) === 'VERB' || (AUXISH(this.tok(j)) && this.pos(j + 1) === 'VERB')) verbInfo = this.vg(j, [aux]);
        else { verbInfo = this.vg(aux); verbInfo.end = j; }
      } else if (this.isVerbStart(j) || ((this.pos(j) === 'ADV' || this.pos(j) === 'NEG') && this.isVerbStart(j + 1))) {
        // imperative: understood "you"
        if (this.pos(j) === 'ADV' || this.pos(j) === 'NEG') { fronted.push([this.unit([j], 'ADV'), 'mod']); j++; }
        subject = this.understood('you', j);
      } else {
        const m = this.mark();
        const s = this.npc(j, 'subject');
        if (!s) { this.rollback(m); return null; }
        subject = s.head;
        j = s.end;
        while ((this.pos(j) === 'ADV' || this.pos(j) === 'NEG') && this.verbAhead(j + 1)) {
          fronted.push([this.unit([j], 'ADV'), 'mod']); j++;
        }
      }
    }
    if (!verbInfo) verbInfo = this.vg(j);
    if (!verbInfo) {
      return { verb: null, end: j, subjectWas: subject, nominal: subject };
    }
    const verb = verbInfo.verb;
    if (subject) this.attach(subject, verb, 'subj');
    if (expl) this.attach(expl, verb, 'expl');
    for (const [u, rel] of fronted) this.attach(u, verb, rel);
    const end = this.predicate(verbInfo, verbInfo.end, { expletive: !!expl, needSubject: !!expl && !subject });
    const state = verbInfo.state;
    if (wh) this.assignFronted(verb, wh, state);
    return { verb, end, subjectWas: subject, state };
  }

  /** Give a fronted wh-word / relative pronoun its role in its clause. */
  assignFronted(verb, w, state) {
    if (w.pos === 'ADV') { this.attach(w, verb, 'mod'); return; }
    const st = state?.state || state || {};
    if (st.stranded && !st.strandedUsed) { this.attach(w, st.stranded, 'pobj'); st.strandedUsed = true; return; }
    const kids = this.units.filter((u) => u.headRef === verb);
    const has = (r) => kids.some((k) => k.rel === r);
    if (!has('subj')) this.attach(w, verb, 'subj');
    else if (st.linking && !has('pred')) this.attach(w, verb, 'pred');
    else if (!has('dobj')) this.attach(w, verb, 'dobj');
    else this.attach(w, verb, 'npadv');
  }

  /** A participle right after a subordinator, with no subject: a reduced clause. */
  reducedAt(k) {
    const t = this.tok(k);
    if (!t || t.pos !== 'VERB') return false;
    return t.tags.has('Gerund') || t.tags.has('Participle') || (t.tags.has('PastTense') && /(ed|en|wn|ne)$/.test(t.norm));
  }

  /** "When sitting for that Purpose": subordinator + participle phrase. */
  reduced(j) {
    const m = this.mark();
    const markU = this.unit([j], 'SCONJ');
    const v = this.verbal(j + 1, 'participle');
    if (!v) { this.rollback(m); return null; }
    this.attach(markU, v.head, 'mark');
    return { verb: v.head, end: v.end };
  }

  subordinate(j) {
    const m = this.mark();
    const markU = this.unit([j], 'SCONJ');
    const c = this.clause(j + 1, { subordinate: true });
    if (!c || !c.verb) { this.rollback(m); return null; }
    this.attach(markU, c.verb, 'mark');
    return { verb: c.verb, end: c.end };
  }

  /** Objects, complements and modifiers after the verb. Returns end index. */
  predicate(v, j, opts = {}) {
    const verb = v.verb;
    const st = { dobj: null, iobj: null, pred: null, ocomp: null, last: null, lastKind: null, lastNominal: null,
      linking: v.linking, stranded: null, needSubject: opts.needSubject };
    v.state = st;
    const lemma = v.lemma;
    for (let guard = 0; guard < 40 && j < this.n; guard++) {
      const p = this.pos(j);
      const t = this.tok(j);
      if (this.comma(j - 1) && this.clauseAt(j)) break;

      const verbList = p === 'VERB' && this.comma(j - 1) && !isGerund(t);
      if (p === 'CCONJ' || verbList) {
        if (p === 'CCONJ' && this.clauseAt(j + 1)) break; // compound sentence: caller handles
        const nx = this.tok(j + 1);
        if (p === 'CCONJ' && nx?.verbish) { nx.pos = 'VERB'; nx.tags.add('Verb'); nx.tags.add('Infinitive'); }
        const off = p === 'CCONJ' ? 1 : 0;
        if (this.isVerbStart(j + off) || (this.pos(j + off) === 'ADV' && this.isVerbStart(j + off + 1))) {
          // compound predicate: "washed the car and waxed the truck"
          const cc = off ? this.unit([j], 'CCONJ') : null;
          let k = j + off;
          const advs = [];
          while (this.pos(k) === 'ADV') advs.push(this.unit([k++], 'ADV'));
          const v2 = this.vg(k);
          if (!v2) { if (cc) this.attach(cc, verb, 'cc'); j++; continue; }
          this.attach(v2.verb, opts.conjHead || verb, 'conj');
          if (cc) this.attach(cc, v2.verb, 'cc');
          for (const a of advs) this.attach(a, v2.verb, 'mod');
          return this.predicate(v2, v2.end, { ...opts, conjHead: opts.conjHead || verb });
        }
        // compound of the last element: "slowly and carefully", "tea and coffee"
        if (st.last) {
          const cc = this.unit([j], 'CCONJ');
          const m = this.mark();
          const item = this.sameKind(st.lastKind, j + 1);
          if (item) {
            this.attach(item.head, st.last, 'conj');
            this.attach(cc, item.head, 'cc');
            j = item.end;
            continue;
          }
          this.rollback(m);
          this.attach(cc, st.last, 'cc');
          j++;
          continue;
        }
        break;
      }

      // reduced adverb clause: "while reading", "if asked"
      if (REDUCING.has(t.norm) && this.reducedAt(j + 1)) {
        const sub = this.reduced(j);
        if (sub) { this.attach(sub.verb, verb, 'advcl'); j = sub.end; st.last = sub.verb; st.lastKind = 'advcl'; continue; }
      }
      // adverb clause: "because it rained"
      if ((p === 'SCONJ' || (p === 'PREP' && SUBORDINATORS.has(t.norm)) || (p === 'WH' && /^(when|where|whenever|wherever)$/.test(t.norm) && !(CLAUSE_VERBS.has(lemma) && !st.dobj)))
        && this.clauseAt(j + 1) && !(/^(whether|if)$/.test(t.norm) && CLAUSE_VERBS.has(lemma) && !st.dobj)) {
        const sub = this.subordinate(j);
        if (sub) { this.attach(sub.verb, verb, 'advcl'); j = sub.end; st.last = sub.verb; st.lastKind = 'advcl'; continue; }
      }

      // noun clause as direct object
      const personObj = st.dobj && !st.iobj && /PRON|PROPN|NOUN/.test(st.dobj.pos) && !this.isVerbalUnit(st.dobj);
      if ((!st.dobj || personObj) && CLAUSE_VERBS.has(lemma)) {
        if ((p === 'THAT' || /^(whether|if)$/.test(t.norm)) && this.clauseAt(j + 1)) {
          const m = this.mark();
          const mk = this.unit([j], 'SCONJ');
          const c = this.clause(j + 1, { subordinate: true });
          if (c && c.verb) {
            if (st.dobj) { st.dobj.rel = 'iobj'; st.iobj = st.dobj; st.dobj = null; }
            this.attach(mk, c.verb, 'mark');
            this.attach(c.verb, verb, 'dobj');
            st.dobj = c.verb; st.last = c.verb; st.lastKind = 'np';
            j = c.end;
            continue;
          }
          this.rollback(m);
        }
        if (p === 'WH') {
          const m = this.mark();
          const c = this.clause(j, { subordinate: false });
          if (c && c.verb) {
            if (st.dobj) { st.dobj.rel = 'iobj'; st.iobj = st.dobj; st.dobj = null; }
            this.attach(c.verb, verb, 'dobj');
            st.dobj = c.verb; st.last = c.verb; st.lastKind = 'np';
            j = c.end;
            continue;
          }
          this.rollback(m);
        }
        if (!st.dobj && this.clauseAt(j) && !st.needSubject && !(lemma === 'tell' || lemma === 'show' || lemma === 'ask')) {
          const m = this.mark();
          const c = this.clause(j, { subordinate: true });
          if (c && c.verb) {
            this.attach(c.verb, verb, 'dobj');
            st.dobj = c.verb; st.last = c.verb; st.lastKind = 'np';
            j = c.end;
            continue;
          }
          this.rollback(m);
        }
      }

      // infinitive: "want to swim" (object) / "went to buy milk" (purpose)
      if (p === 'TO' && this.isVerbStart(j + 1)) {
        const inf = this.verbal(j, 'infinitive');
        if (inf) {
          if (!st.dobj && !st.pred && INFINITIVE_VERBS.has(lemma)) { this.attach(inf.head, verb, 'dobj'); st.dobj = inf.head; }
          else if (!st.pred && v.linking && lemma === 'be') { this.attach(inf.head, verb, 'pred'); st.pred = inf.head; }
          else if (st.lastKind === 'np' && st.lastNominal && !this.comma(j - 1)
            && INFINITIVE_NOUNS.has(this.t.find((x) => x.i === st.lastNominal.tokens.at(-1))?.norm)) this.attach(inf.head, st.lastNominal, 'mod');
          else this.attach(inf.head, verb, 'mod');
          st.last = inf.head; st.lastKind = 'inf';
          j = inf.end;
          continue;
        }
      }

      // gerund object: "enjoy swimming"
      if (isGerund(t) && !st.dobj && !v.auxOnly) {
        const g = this.verbal(j, 'gerund');
        if (g) {
          this.attach(g.head, verb, GERUND_VERBS.has(lemma) || !v.linking ? 'dobj' : 'pred');
          if (GERUND_VERBS.has(lemma) || !v.linking) st.dobj = g.head; else st.pred = g.head;
          st.last = g.head; st.lastKind = 'np';
          j = g.end;
          continue;
        }
      }

      // participial phrase after the verb: "She came running"
      if (p === 'VERB' && (t.tags.has('Gerund')) && st.dobj) {
        const g = this.verbal(j, 'participle');
        if (g) { this.attach(g.head, st.dobj, 'mod'); j = g.end; continue; }
      }

      // noun phrases: objects and complements
      if (NP_START.has(p) || p === 'THAT' || (p === 'WH' && this.pos(j + 1) === 'NOUN')) {
        if (p === 'ADJ' && this.skipNP(j) < 0) { /* falls to adjective handling */ }
        else if (p === 'THAT' && this.skipNP(j) < 0) break;
        else {
          const m = this.mark();
          const npx = this.npc(j, 'object', lemma);
          if (npx) {
            const head = npx.head;
            const headTok = this.t.find((x) => x.i === head.tokens.at(-1));
            const adverbial = headTok && !v.nominalLinking && (ADVERBIAL_NOUNS.has(headTok.norm) || headTok.tags.has('Date') || headTok.tags.has('Duration'))
              && !(st.needSubject);
            if (st.needSubject) {
              this.attach(head, verb, 'subj'); st.needSubject = false;
            } else if (adverbial) {
              this.attach(head, verb, 'npadv');
            } else if (v.nominalLinking && !st.pred && !st.dobj) {
              this.attach(head, verb, 'pred'); st.pred = head;
            } else if (!st.dobj && !st.pred) {
              const nextNP = !this.comma(npx.end - 1) && NP_START.has(this.pos(npx.end)) && this.skipNP(npx.end) > 0
                && !this.clauseAt(npx.end) && this.pos(npx.end) !== 'ADJ';
              const nextAdj = this.pos(npx.end) === 'ADJ' || (this.pos(npx.end) === 'ADV' && this.pos(npx.end + 1) === 'ADJ');
              if (nextNP && !OBJ_COMPLEMENT_VERBS.has(lemma)) {
                this.attach(head, verb, 'iobj'); st.iobj = head;
              } else {
                this.attach(head, verb, 'dobj'); st.dobj = head;
                if (OBJ_COMPLEMENT_VERBS.has(lemma) && (nextNP || nextAdj)) st.expectOC = true;
              }
            } else if (st.dobj && !st.ocomp && st.expectOC) {
              this.attach(head, verb, 'ocomp'); st.ocomp = head;
            } else if (st.iobj && !st.dobj) {
              this.attach(head, verb, 'dobj'); st.dobj = head;
            } else {
              this.attach(head, verb, 'npadv');
            }
            st.last = head; st.lastKind = 'np'; st.lastNominal = head;
            j = npx.end;
            continue;
          }
          this.rollback(m);
        }
      }

      // adjectives: predicate adjective / object complement
      if (p === 'ADJ' || ((p === 'ADV' || p === 'NEG') && this.pos(j + 1) === 'ADJ') || (p === 'VERB' && t.tags.has('Participle') && v.linking)) {
        const a = this.adjp(j);
        if (a) {
          if (v.linking && !st.pred && !st.dobj) { this.attach(a.head, verb, 'pred'); st.pred = a.head; }
          else if (st.dobj && !st.ocomp) { this.attach(a.head, verb, 'ocomp'); st.ocomp = a.head; }
          else this.attach(a.head, verb, 'mod');
          st.last = a.head; st.lastKind = 'adj'; st.lastAdj = a.head;
          j = a.end;
          continue;
        }
      }

      // adverbs
      if (p === 'ADV' || p === 'NEG') {
        const u = this.unit([j], 'ADV');
        if (this.pos(j + 1) === 'ADV' && !this.comma(j)) {
          const u2 = this.unit([j + 1], 'ADV');
          this.attach(u, u2, 'mod');
          this.attach(u2, verb, 'mod');
          st.last = u2; st.lastKind = 'adv';
          j += 2;
          continue;
        }
        this.attach(u, verb, 'mod');
        st.last = u; st.lastKind = 'adv';
        j++;
        continue;
      }

      // a preposition with no object ("went out for pizza") works as an adverb
      if ((p === 'PREP' || p === 'PART') && !this.comma(j) && (/PREP|TO/.test(this.pos(j + 1) || '') || j + 1 >= this.n) && !st.stranded && !opts.nonfinite
        && /^(out|up|down|in|off|on|away|back|over|around|about|along|inside|outside|by|through)$/.test(t.norm)) {
        this.attach(this.unit([j], 'ADV'), verb, 'mod');
        st.last = null; j++;
        continue;
      }
      // prepositional phrases
      if (p === 'PREP' || p === 'TO' || p === 'PART') {
        const pp = this.pp(j);
        let host = verb;
        const pn = pp.prep ? this.tok(j).norm : '';
        if (pn === 'of' && st.lastNominal && st.lastKind === 'np') host = st.lastNominal;
        else if (st.lastKind === 'adj' && st.lastAdj && /^(of|with|about|for|to|at|by)$/.test(pn)) host = st.lastAdj;
        this.attach(pp.prep, host, 'prep');
        if (pp.stranded) st.stranded = pp.prep;
        st.last = pp.prep; st.lastKind = 'pp';
        j = pp.end;
        continue;
      }

      if (p === 'INTJ') { this.attach(this.unit([j], 'INTJ'), verb, 'intj'); j++; continue; }
      break;
    }
    return j;
  }

  /** Parse an item of the same kind as the previous one, for compounds. */
  sameKind(kind, j) {
    if (kind === 'np') {
      if (this.clauseAt(j)) return null;
      const x = this.npc(j, 'object');
      return x ? { head: x.head, end: x.end } : null;
    }
    if (kind === 'adj') return this.adjp(j);
    if (kind === 'adv') {
      if (this.pos(j) !== 'ADV') return null;
      return { head: this.unit([j], 'ADV'), end: j + 1 };
    }
    if (kind === 'pp') {
      if (this.pos(j) !== 'PREP' && this.pos(j) !== 'TO') return null;
      const pp = this.pp(j);
      return { head: pp.prep, end: pp.end };
    }
    if (kind === 'inf') {
      if (this.pos(j) === 'TO' && this.isVerbStart(j + 1)) return this.verbal(j, 'infinitive');
      return null;
    }
    return null;
  }

  // ---------- sentence ----------

  run() {
    let j = 0;
    const floats = [];
    // leading interjections and nouns of address ("Wow," / "John, come here.")
    while (j < this.n && this.pos(j) === 'INTJ') floats.push(this.unit([j++], 'INTJ'));
    const t0 = this.tok(j);
    if (t0 && /PROPN|NOUN/.test(t0.pos) && !t0.tags.has('Date') && !ADVERBIAL_NOUNS.has(t0.norm) && this.comma(j)
      && (this.isVerbStart(j + 1) || this.pos(j + 1) === 'PRON' || this.pos(j + 1) === 'ADV')) {
      floats.push(this.unit([j++]));
    }
    let main = this.clause(j, {});
    let root = null;
    if (main && main.verb) {
      root = main.verb;
      j = main.end;
    } else if (main && main.subjectWas) {
      // a fragment ("The big red dog.") - draw the noun phrase on its own line
      root = main.subjectWas;
      j = main.end;
    }
    if (root) { root.rel = 'root'; root.headRef = null; }

    // more clauses: compound sentences and trailing adverb clauses
    for (let guard = 0; guard < 10 && j < this.n && root; guard++) {
      const p = this.pos(j);
      if ((p === 'CCONJ' && this.clauseAt(j + 1)) || ((this.semi(j - 1) || this.comma(j - 1)) && this.clauseAt(j))) {
        const cc = p === 'CCONJ' ? this.unit([j++], 'CCONJ') : null;
        const c = this.clause(j, {});
        if (c && c.verb) {
          this.attach(c.verb, root, 'conj');
          if (cc) this.attach(cc, c.verb, 'cc');
          j = c.end;
          continue;
        }
        if (cc) this.attach(cc, root, 'cc');
        continue;
      }
      if ((p === 'SCONJ' || p === 'WH' || p === 'PREP') && this.clauseAt(j + 1)) {
        const sub = this.subordinate(j);
        if (sub) { this.attach(sub.verb, root, 'advcl'); j = sub.end; continue; }
      }
      // trailing noun of address: "Come here, John."
      if (this.comma(j - 1) && /PROPN/.test(p) && j === this.n - 1) { floats.push(this.unit([j++])); continue; }
      // trailing phrase the predicate didn't take
      if (p === 'PREP' || p === 'TO') { const pp = this.pp(j); this.attach(pp.prep, root, 'prep'); j = pp.end; continue; }
      break;
    }

    for (const f of floats) this.attach(f, root, 'intj');

    // anything left over gets its own unit, unattached, for the user to place
    for (let k = 0; k < this.n; k++) {
      if (this.unitOfTok.has(k)) continue;
      const u = this.unit([k]);
      if (root && /ADV|NEG/.test(u.pos)) this.attach(u, root, 'mod');
      else u.rel = root ? 'float' : (root = u, 'root');
    }
    // safety: units that ended up without a head besides the root float
    for (const u of this.units) {
      if (u.sent !== this.si) continue;
      if (!u.headRef && u !== root && u.rel !== 'float') u.rel = 'float';
      if (u.headRef === u) { u.headRef = null; u.rel = 'float'; }
    }
  }
}
