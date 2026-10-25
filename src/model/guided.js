// Guided mode: the learner diagrams a sentence the way it's taught in class,
// one question at a time — find the verb, then the subject, then what
// completes the verb, then where every other word hangs, then the same for
// each clause — and the diagram builds itself from their answers. A wrong
// answer gets an explanation built from what the clicked word really does in
// the sentence (the parser's answer key).

import { Graph, NOMINAL_POS } from './graph.js';

// Placed along with the word they hang from, never asked about: conjunctions
// (once both parts of their compound are found), subordinators and the "to"
// of an infinitive, and expletives like "there" (once the real subject is found).
const AUTO = new Set(['cc', 'mark', 'expl']);
const CORE = new Set(['subj', 'dobj', 'pred', 'iobj', 'ocomp', 'pobj']);

// ---------- reading the answer key ----------

const byOrder = (g) => (a, b) => g.order(a) - g.order(b);

/** A verb with its own clause: the main verb, or one with its own subject. */
export function isClauseVerb(g, u) {
  if (u.rel === 'root') return true;
  return g.isVerbal(u) && (u.rel === 'advcl' || u.rel === 'relcl' || !!g.kid(u, 'subj'));
}

function clauseOf(g, u) {
  for (let c = u, n = 0; c && n < 60; c = g.head(c), n++) if (isClauseVerb(g, c)) return c;
  return null;
}

const topOf = (g, u) => {
  let c = u;
  for (let n = 0; n < 30 && c.rel === 'conj' && c.head != null; n++) c = g.head(c);
  return c;
};

/**
 * The parts of a compound, in reading order. A joined verb with its own
 * subject is a separate clause, not part of a compound verb, unless asked.
 */
function compound(g, u, withClauses = false) {
  const out = [u];
  for (let k = 0; k < out.length; k++) {
    for (const c of g.kids(out[k], 'conj')) {
      if (!withClauses && g.isVerbal(c) && g.kid(c, 'subj')) continue;
      out.push(c);
    }
  }
  return out.sort(byOrder(g));
}

function subtree(g, u) {
  const out = [u];
  for (let k = 0; k < out.length; k++) out.push(...g.kids(out[k]));
  return out;
}

/** Words from the given tokens in reading order, with the sentence's first word lowercased. */
function words(g, idxs) {
  const ts = [...new Set(idxs)].sort((a, b) => a - b).map((i) => g.tokens[i]);
  return ts.map((t, k) => {
    let s = t.text;
    const first = !g.tokens.some((x) => x.sent === t.sent && x.i < t.i);
    if (k === 0 && first && t.pos !== 'PROPN' && s !== 'I') s = s.charAt(0).toLowerCase() + s.slice(1);
    return s;
  }).join(' ').replace(/ (n't|'\w*)/g, '$1');
}

/** One unit's own words: "jumped", "did see", "(you)". */
const word = (g, u) => (u.understood ? `(${u.text})` : u.implied ? g.text(u) : words(g, u.tokens));
/** A unit and everything hanging from it: "over the lazy dog". A long one is cut in the middle. */
const span = (g, u) => {
  const s = words(g, subtree(g, u).flatMap((x) => x.tokens)).split(' ');
  return s.length > 8 ? `${s.slice(0, 4).join(' ')} … ${s.slice(-3).join(' ')}` : s.join(' ');
};
const q = (s) => `“${s}”`;

/** "John and Mary", "laughed, sang and danced". */
function list(g, units) {
  const ws = units.map((u) => word(g, u));
  if (ws.length < 2) return ws[0] || '';
  const cc = units.flatMap((u) => g.kids(u, 'cc'))[0];
  const and = cc ? word(g, cc) : 'and';
  return `${ws.slice(0, -1).join(', ')} ${and} ${ws.at(-1)}`;
}

/** A noun with its article, for questions: "the fox". */
function nounText(g, u) {
  if (u.understood) return u.text;
  const det = g.kids(u, 'mod').find((k) => (k.pos === 'DET' || k.pos === 'POSS') && g.order(k) < g.order(u));
  return det ? words(g, [...det.tokens, ...u.tokens]) : word(g, u);
}

/** Unit ids that are placed automatically once `set` holds their heads. */
function settle(g, set) {
  for (let grew = true; grew;) {
    grew = false;
    for (const u of g.units) {
      if (set.has(u.id) || !AUTO.has(u.rel) || u.head == null || !set.has(u.head)) continue;
      const h = g.head(u);
      if (u.rel === 'cc' && compound(g, topOf(g, h), true).filter((x) => set.has(x.id)).length < 2) continue;
      if (u.rel === 'expl' && !g.kids(h, 'subj').some((s) => set.has(s.id))) continue;
      set.add(u.id);
      grew = true;
    }
  }
}

/** How a word that hangs from another is asked about. */
function formOf(g, u) {
  if (u.rel === 'intj') return 'intj';
  if (u.rel === 'prep' || u.pos === 'PREP') return 'prep';
  if (u.rel === 'advcl') return 'advcl';
  if (u.rel === 'relcl') return 'relcl';
  if (u.rel === 'appos') return 'appos';
  if (u.rel === 'npadv') return 'npadv';
  if (g.isVerbal(u)) return g.kids(u, 'mark').some((m) => m.pos === 'TO') ? 'inf' : 'part';
  if (['DET', 'ADJ', 'POSS', 'NUM'].includes(u.pos) || NOMINAL_POS.has(u.pos)) return 'adj';
  if (u.pos === 'ADV' || u.pos === 'NEG') return 'adv';
  return 'other';
}

const PHRASE_FORMS = new Set(['prep', 'advcl', 'relcl', 'part', 'inf', 'appos']);
const VERB_OF = { adj: 'describe', relcl: 'describe', part: 'describe', appos: 'rename', other: 'go with' };
const ROLE_NAME = { subj: 'subject', dobj: 'object', pred: 'complement', pobj: 'object', iobj: 'indirect object', ocomp: 'object complement' };

const TIP = {
  verb: 'Ask what is happening, or what something is. Helping verbs like is, has, will and do count as part of the verb.',
  complement: 'Say the subject and verb, then ask “whom or what?” After an action verb, the answer receives the action: a direct object. After a linking verb (is, seems, looks, becomes), it renames or describes the subject. Sometimes nothing answers.',
  iobj: 'The indirect object tells to whom or for whom something is done. It comes between the verb and the direct object.',
  ocomp: 'An object complement comes right after the direct object and renames or describes it.',
  pobj: 'The object of a preposition is the noun or pronoun that ends its phrase.',
  adj: 'Adjectives and articles describe nouns, usually the next noun after them.',
  adv: 'Adverbs tell about verbs, adjectives or other adverbs: how, when, where or how much.',
  npadv: 'A noun used as an adverb tells when, where or how much about a verb.',
  prep: 'A phrase works like an adjective (which one? what kind?) or like an adverb (how? when? where? why?). Try it with each word: does it answer one of those?',
  advcl: 'An adverb clause tells when, where, why or how about a verb, most often the main verb.',
  relcl: 'An adjective clause describes the noun just before it.',
  part: 'A participle phrase describes a noun, usually one right beside it.',
  inf: 'An infinitive phrase can tell why about a verb, or what kind about a noun.',
  appos: 'An appositive renames the noun it sits beside, usually between commas.',
  intj: 'Some words belong to no other word. Interjections like wow, oh and hey stand apart from the sentence.',
  other: 'Read the word with each word on the diagram. Which pair makes sense together?',
};

/** What a word is, in a sentence, for explaining why it isn't the answer. */
function whatIs(g, c) {
  const w = q(word(g, c));
  if (g.isVerbal(c)) {
    if (isClauseVerb(g, c)) return `${w} is a verb.`;
    if (g.kids(c, 'mark').some((m) => m.pos === 'TO')) return `${w} is part of the infinitive ${q(`to ${word(g, c)}`)}, a verb form that works like a noun, adjective or adverb.`;
    if (c.rel === 'mod') return `${w} is a verb form, but here it describes ${q(word(g, g.head(c)))} (a participle).`;
    return `${w} is a verb form working as a noun (a gerund).`;
  }
  if (c.rel === 'mark') return c.pos === 'TO' ? `${w} marks an infinitive.` : `${w} starts a clause.`;
  switch (c.pos) {
    case 'DET': return `${w} is an article: it points to a noun.`;
    case 'POSS': return `${w} tells whose: it goes with a noun.`;
    case 'ADJ': return `${w} is an adjective: it describes a noun.`;
    case 'NUM': return `${w} is a number: it works like an adjective.`;
    case 'ADV': case 'NEG': return `${w} is an adverb: it tells how, when, where or how much.`;
    case 'PREP': return `${w} is a preposition: it starts the phrase ${q(span(g, c))}.`;
    case 'CCONJ': return `${w} is a conjunction: it joins words or groups of words.`;
    case 'INTJ': return `${w} is an interjection: it stands apart from the rest of the sentence.`;
    case 'NOUN': case 'PROPN': return `${w} is a noun: it names a person, place, thing or idea.`;
    case 'PRON': return c.relPron ? `${w} is a relative pronoun: it stands for a noun and starts a clause.` : `${w} is a pronoun: it stands in for a noun.`;
    default: return `${w} isn't it.`;
  }
}

function clauseName(g, v) {
  const h = g.head(v);
  if (v.rel === 'advcl') return `the clause ${q(span(g, v))}, which tells about ${q(word(g, h))}`;
  if (v.rel === 'relcl') return `the clause ${q(span(g, v))}, which describes ${q(word(g, h))}`;
  if (v.rel === 'conj') return `the second clause, ${q(span(g, v))}`;
  if (v.rel === 'root') return 'another sentence';
  return `the clause ${q(span(g, v))}`;
}

/** A preposition between a word and its clause's verb, if the word is inside a phrase. */
function phraseOf(g, c, home) {
  for (let x = c, n = 0; x && n < 60 && x !== home; x = g.head(x), n++) if (x.rel === 'prep') return x;
  return null;
}

// ---------- the plan ----------

/**
 * The questions for a sentence, in teaching order. Each step is either
 * "find" (click the word that plays a part) or "attach" (click the word this
 * one hangs from). Steps may also offer a "none" answer.
 */
export function planSteps(g) {
  const steps = [];
  const sched = new Set();
  const add = (ids) => { for (const id of ids) sched.add(id); settle(g, sched); };
  const roots = g.units.filter((u) => u.head == null && u.rel === 'root').sort(byOrder(g));

  /** The subject as a question puts it: "the fox", "John and Mary", "you". */
  const subjText = (v) => {
    const s = g.kid(v, 'subj');
    if (!s) return '';
    const parts = compound(g, s);
    return parts.length > 1 ? list(g, parts) : nounText(g, s);
  };

  const verbStep = (v, verbs) => {
    const sub = v.rel !== 'root';
    const mark = g.kids(v, 'mark').find((m) => m.pos !== 'TO');
    const noun = sub && !['advcl', 'relcl', 'conj'].includes(v.rel);
    let right;
    if (verbs.length > 1) right = `Yes: ${verbs.map((x) => q(word(g, x))).join(' and ')} make a compound verb, so the baseline forks.`;
    else if (!sub) right = `Yes: ${q(word(g, v))} is the verb. It goes on the baseline, right of the divider.`;
    else if (v.rel === 'conj') {
      const cc = g.kids(v, 'cc')[0];
      right = `Yes: ${q(word(g, v))} is the verb of the second clause. The two clauses are joined${cc ? ` by ${q(word(g, cc))}` : ''} on a dashed line.`;
    } else if (noun) right = `Yes: ${q(word(g, v))} is its verb. A clause used as a noun stands on a pedestal in the ${ROLE_NAME[v.rel] || 'noun'}'s place.${mark ? ` ${q(word(g, mark))} floats above it.` : ''}`;
    else right = `Yes: ${q(word(g, v))} is the clause's verb. The clause gets its own baseline below.${mark ? ` ${q(word(g, mark))} rides on the dashed line that ties it in.` : ''}`;
    return {
      kind: 'find', phase: 'verb', home: v.id, sub, sent: v.sent,
      title: sub ? `Find the verb of ${q(span(g, v))}` : roots.length > 1 ? `Find the verb of sentence ${roots.indexOf(v) + 1}` : 'Find the verb',
      ask: !sub ? 'Which word tells what someone or something does or is?'
        : v.rel === 'conj' ? 'This is a second clause, with its own subject and verb. Which word is its verb?'
        : 'A clause has its own subject and verb. Which word is the verb of this one?',
      tip: TIP.verb, targets: verbs.map((x) => x.id), verbs: verbs.map((x) => x.id), right,
      partial: (n) => `Yes, that's one of the verbs. This one has a compound verb: find the other${n > 1 ? ` ${n}` : ''}.`,
    };
  };

  /** A step that finds the word playing `t`'s part (subject, object, …). */
  const roleStep = (t) => {
    const h = g.head(t);
    const home = clauseOf(g, h) || h;
    const group = isClauseVerb(g, t) ? [t] : compound(g, t);
    const ids = group.map((x) => x.id);
    const markOf = new Map();
    for (const x of group) for (const m of g.kids(x, 'mark')) markOf.set(m.id, x.id);
    const clauseAnswer = isClauseVerb(g, t) && t.rel !== 'root';
    const st = {
      kind: 'find', phase: t.rel === 'subj' ? 'subject' : t.rel === 'dobj' || t.rel === 'pred' ? 'complement' : t.rel,
      home: home.id, sub: home.rel !== 'root', sent: t.sent, targets: ids, markOf,
      span: clauseAnswer ? new Set(subtree(g, t).map((x) => x.id)) : null,
    };
    const what = clauseAnswer ? `the whole clause ${q(span(g, t))}`
      : g.isVerbal(t) ? `the ${formOf(g, t) === 'inf' ? 'infinitive' : 'gerund'} ${q(span(g, t))}` : null;
    const pedestal = what ? (clauseAnswer ? ' Next, find its verb.' : ' A verb form used as a noun stands on a pedestal.') : '';
    const many = group.length > 1;

    if (t.rel === 'subj') {
      const verbs = compound(g, h);
      // a linking verb reads better with its complement: "who or what looks happy?"
      const pred = g.kid(h, 'pred');
      const preds = pred ? compound(g, pred) : [];
      const comp = preds.length > 1 ? list(g, preds) : pred ? nounText(g, pred) : '';
      const question = `${q(`who or what ${list(g, verbs)}${comp ? ` ${comp}` : ''}?`)}`;
      Object.assign(st, {
        verbs: verbs.map((x) => x.id), question,
        title: st.sub ? `Find the subject of ${q(word(g, h))}` : 'Find the subject',
        ask: `Ask: ${question}`,
        none: 'It isn’t written',
      });
      const expl = g.kid(h, 'expl');
      if (t.understood) {
        Object.assign(st, {
          targets: [], noneRight: true, place: [t.id],
          tip: `Read it aloud. If no word answers ${question}, the subject may be understood, like the “you” in a command.`,
          right: `Right: no word answers ${question} ${h.rel === 'root' ? 'It’s a command, so' : 'It’s left out, so'} the subject is understood: ${q(word(g, t))}, written in parentheses.`,
        });
      } else {
        Object.assign(st, {
          noneWrong: `The subject is written here. Ask: ${question}`,
          tip: `Say the verb, then ask ${question} The answer is a noun or pronoun (or a phrase or clause doing a noun's job), and it's never inside a prepositional phrase.`,
          right: (what ? `Yes: ${what} is the subject.${pedestal}`
            : many ? `Yes: ${group.map((x) => q(word(g, x))).join(' and ')} make a compound subject, so the subject's line forks.`
            : t.relPron ? `Yes: ${q(word(g, t))} is the subject. It stands for ${q(word(g, g.head(h)))}.`
            : `Yes: ${q(word(g, t))} is the subject. It goes first on the baseline, left of the divider.`)
            + (expl ? ` ${q(word(g, expl))} only fills the subject's spot, so it floats above the baseline.` : ''),
        });
      }
    } else if (t.rel === 'dobj' || t.rel === 'pred') {
      // the second verb of a compound verb shares the first one's subject
      const owner = h.rel === 'conj' && g.isVerbal(h) && !g.kid(h, 'subj') ? topOf(g, h) : h;
      const clause = isClauseVerb(g, owner);
      const s = clause ? subjText(owner) : '';
      const asks = g.kid(h, 'iobj') ? 'what' : 'whom or what';
      const question = q(`${s ? `${s} ` : ''}${word(g, h)} ${asks}?`);
      const kind = t.rel === 'dobj' ? 'direct object' : 'subject complement';
      Object.assign(st, {
        verbs: [h.id], question,
        title: clause ? `What completes ${q(`${s ? `${s} ` : ''}${word(g, h)}`)}?` : `Find the object of ${q(word(g, h))}`,
        ask: `Ask: ${question}${clause ? ' Click the word that answers, or “Nothing answers”.' : ''}`,
        none: clause ? 'Nothing answers' : null,
        noneWrong: `Something does answer ${question} Look near the verb.`,
        tip: TIP.complement,
        right: what ? `Yes: ${what} is the ${t.rel === 'dobj' ? 'object' : 'complement'}.${pedestal}`
          : t.rel === 'dobj' ? `Yes: ${many ? group.map((x) => q(word(g, x))).join(' and ') : q(word(g, t))} ${many ? 'are' : 'is'} the ${kind}: ${many ? 'they receive' : 'it receives'} the action. It follows the verb, behind a short line${many ? ' that forks' : ''}.`
          : `Yes: ${q(word(g, t))} ${NOMINAL_POS.has(t.pos) ? 'renames' : 'describes'} the subject, because ${q(word(g, h))} is a linking verb here. It's a ${kind}: its line slants back toward the subject.`,
      });
    } else if (t.rel === 'iobj') {
      const d = g.kid(h, 'dobj');
      const question = q(`${subjText(h)} ${word(g, h)}${d ? ` ${nounText(g, d)}` : ''} to whom or for whom?`);
      Object.assign(st, {
        verbs: [h.id], question, title: 'Find the indirect object', ask: `Ask: ${question}`, tip: TIP.iobj,
        right: `Yes: ${q(word(g, t))} is the indirect object. It hangs under the verb on an empty slant, like a phrase with no preposition.`,
      });
    } else if (t.rel === 'ocomp') {
      const d = g.kid(h, 'dobj');
      const question = q(`${subjText(h)} ${word(g, h)}${d ? ` ${nounText(g, d)}` : ''} what?`);
      Object.assign(st, {
        verbs: [h.id], question, title: 'Find the object complement',
        ask: `Ask: ${question} The answer renames or describes ${d ? q(word(g, d)) : 'the object'}.`, tip: TIP.ocomp,
        right: `Yes: ${q(word(g, t))} ${NOMINAL_POS.has(t.pos) ? 'renames' : 'describes'} ${d ? q(word(g, d)) : 'the object'}: it's an object complement. It follows the object, behind a line slanting back toward it.`,
      });
    } else {
      // the object of a preposition
      const question = q(`${word(g, h)} whom or what?`);
      Object.assign(st, {
        phase: 'pobj', verbs: [], head: h.id, question,
        title: `Find the object of ${q(word(g, h))}`, ask: `Ask: ${question}`, tip: TIP.pobj,
        right: what ? `Yes: ${what} is the object of ${q(word(g, h))}.${pedestal}`
          : `Yes: ${many ? group.map((x) => q(word(g, x))).join(' and ') : q(word(g, t))} ${many ? 'are the objects' : 'is the object'} of ${q(word(g, h))}. ${many ? 'They sit' : 'It sits'} on the flat line at the foot of the slant.`,
      });
    }
    st.partial = (n) => `Yes, that's part of the ${ROLE_NAME[t.rel] || 'answer'}. It's compound: find the other part${n > 1 ? 's' : ''}${g.kids(group.at(-1), 'cc')[0] ? `, joined by ${q(word(g, g.kids(group.at(-1), 'cc')[0]))}` : ''}.`;
    if (st.right && st.place == null) st.place = clauseAnswer ? [] : ids;
    return st;
  };

  const noObjectStep = (v, verbs) => {
    const s = subjText(v);
    const question = q(`${s ? `${s} ` : ''}${list(g, verbs)} whom or what?`);
    return {
      kind: 'find', phase: 'complement', home: v.id, sub: v.rel !== 'root', sent: v.sent,
      targets: [], verbs: verbs.map((x) => x.id), question, none: 'Nothing answers', noneRight: true, place: [],
      title: `What completes ${q(`${s ? `${s} ` : ''}${list(g, verbs)}`)}?`,
      ask: `Ask: ${question} Click the word that answers, or “Nothing answers”.`,
      tip: TIP.complement,
      right: `Right: no word answers ${question} So ${verbs.length > 1 ? 'these verbs have' : `${q(word(g, v))} has`} no object or complement.`,
    };
  };

  const attachStep = (u) => {
    const h = g.head(u);
    const conj = u.rel === 'conj';
    // a joined part is asked about the way the part it's joined to would be
    const form = formOf(g, conj ? topOf(g, u) : u);
    const label = PHRASE_FORMS.has(form) ? q(span(g, u)) : q(word(g, u));
    const verb = VERB_OF[form] || 'tell about';
    const heads = new Set([h.id]);
    if (conj && topOf(g, u).head != null) heads.add(topOf(g, u).head);
    const home = clauseOf(g, h) || h;
    const H = q(word(g, h));
    const ask = {
      adj: u.pos === 'POSS' ? `Whose? Which word does ${label} go with?` : `Which word does ${label} describe?`,
      adv: `Which word does ${label} tell about? Adverbs tell how, when, where or how much.`,
      npadv: `Which word does ${label} tell about? It's a noun doing an adverb's job.`,
      prep: 'It’s a prepositional phrase. Which word does it tell about?',
      advcl: 'It’s an adverb clause. Which word does it tell about?',
      relcl: 'It’s an adjective clause. Which word does it describe?',
      part: 'It’s a participle phrase. Which word does it describe?',
      inf: 'It’s an infinitive phrase. Which word does it tell about?',
      appos: `Which word does ${label} rename?`,
      other: `Which word does ${label} go with?`,
    }[form];
    const right = (hid) => {
      if (conj) {
        const top = topOf(g, u), cc = g.kids(u, 'cc')[0];
        return `Yes: ${label} is joined to ${q(word(g, top))}${cc ? ` by ${q(word(g, cc))}` : ''}, so they share a fork${top.head ? ` under ${q(word(g, g.head(top)))}` : ''}.`;
      }
      return {
        adj: `Yes: ${label} describes ${H}, so it hangs on a slant under it.`,
        adv: `Yes: ${label} tells about ${H}, so it hangs on a slant under it.`,
        npadv: `Yes: ${label} tells about ${H}, so it hangs under it.`,
        prep: `Yes: the phrase tells about ${H}. It hangs under it: the preposition on a slant, then a flat line for its object.`,
        advcl: `Yes: the clause tells about ${H}. Next, find its verb.`,
        relcl: `Yes: the clause describes ${H}. Next, find its verb.`,
        part: `Yes: ${label} describes ${H}. The participle bends under it.`,
        inf: `Yes: ${label} tells about ${H}. The infinitive hangs under it.`,
        appos: `Yes: ${label} renames ${H}, so it sits beside it in parentheses.`,
        other: `Yes: ${label} goes with ${H}.`,
      }[form] || `Yes: it goes with ${q(word(g, g.get(hid)))}.`;
    };
    return {
      kind: 'attach', phase: form === 'advcl' || form === 'relcl' ? 'clause' : 'modifier', form, conj,
      home: home.id, sub: home.rel !== 'root' || form === 'advcl' || form === 'relcl', sent: u.sent,
      unit: u.id, heads, label, verb, title: `Where does ${label} go?`, ask, tip: TIP[form] || TIP.other, right,
      focus: PHRASE_FORMS.has(form) ? subtree(g, u).map((x) => x.id) : [u.id],
      // a clause goes on the diagram once its verb is found
      place: form === 'advcl' || form === 'relcl' ? [] : [u.id],
    };
  };

  const intjStep = (u) => ({
    kind: 'attach', phase: 'modifier', form: 'intj', home: (clauseOf(g, g.head(u) || u) || u).id, sub: false, sent: u.sent,
    unit: u.id, heads: new Set(), label: q(word(g, u)), verb: 'tell about', focus: [u.id],
    title: `Where does ${q(word(g, u))} go?`,
    ask: `Which word does ${q(word(g, u))} describe or tell about? If none, say so.`,
    none: 'It stands apart', noneRight: true, place: [u.id], tip: TIP.intj,
    right: `Right: ${q(word(g, u))} is an interjection. It belongs to no other word, so it floats above the diagram.`,
  });

  const clause = (v) => {
    const verbs = compound(g, v).filter((x) => x === v || g.isVerbal(x));
    if (v.rel === 'advcl' || v.rel === 'relcl') steps.push(attachStep(v));
    steps.push(verbStep(v, verbs));
    add(verbs.map((x) => x.id));
    const s = g.kid(v, 'subj');
    if (s) role(s);
    const comps = verbs.flatMap((x) => g.kids(x, 'dobj', 'pred'));
    if (!comps.length) { if (g.isVerbal(v)) steps.push(noObjectStep(v, verbs)); }
    for (const c of comps) if (!sched.has(c.id)) role(c);
    for (const x of verbs) for (const c of g.kids(x, 'iobj', 'ocomp')) if (!sched.has(c.id)) role(c);
  };

  const role = (t) => {
    const st = roleStep(t);
    steps.push(st);
    if (st.span) clause(t);
    else add(t.understood ? [t.id] : st.targets);
  };

  const next = (u) => {
    if (u.rel === 'intj') { steps.push(intjStep(u)); add([u.id]); return; }
    // a clause doing a noun's job is found by its job first, then its verb
    if (CORE.has(u.rel)) return role(u);
    if (isClauseVerb(g, u)) return clause(u);
    steps.push(attachStep(u));
    add([u.id]);
    if (u.rel === 'prep' || u.pos === 'PREP') for (const o of g.kids(u, 'pobj')) if (!sched.has(o.id)) role(o);
  };

  for (const r of roots) {
    clause(r);
    // then everything else in the sentence, in reading order, once what it hangs from is on the board
    for (let guard = 0; guard < 500; guard++) {
      const u = g.units
        .filter((x) => x.sent === r.sent && !sched.has(x.id) && !AUTO.has(x.rel) && !x.understood && x.rel !== 'float'
          && (x.head == null ? x.rel === 'intj' : sched.has(x.head)))
        .sort(byOrder(g))[0];
      if (!u) break;
      next(u);
      sched.add(u.id);
    }
  }
  return steps;
}

// ---------- a learner working through the plan ----------

export class Guide {
  constructor(tokens, key) {
    this.key = key;
    this.g = new Graph(tokens, key);
    this.steps = planSteps(this.g);
    this.placed = new Set();
    this.i = 0;
    this.results = []; // per finished step: 'first' | 'missed' | 'hinted' | 'shown'
    this.resetStep();
  }

  resetStep() {
    this.got = new Set();
    this.misses = 0;
    this.hints = 0;
    this.shown = false;
    this.narrow = null;
  }

  get step() { return this.steps[this.i] || null; }
  get done() { return this.i >= this.steps.length; }

  /** 0 verb, 1 subject, 2 what completes it, 3 modifiers, 4 other clauses, 5 done. */
  phaseIndex() {
    const st = this.step;
    if (!st) return 5;
    if (st.sub) return 4;
    return { verb: 0, subject: 1, complement: 2, iobj: 2, ocomp: 2 }[st.phase] ?? 3;
  }

  /** The answer key cut down to what's been found, for drawing. */
  units() {
    const { g, placed } = this;
    return this.key.map((u) => {
      if (!placed.has(u.id)) return { ...u, head: null, rel: 'float' };
      let cur = u, rel = u.rel, head = u.head;
      // a compound part found before the first part stands in for it
      while (cur.rel === 'conj' && cur.head != null && !placed.has(cur.head)) {
        cur = g.get(cur.head);
        rel = cur.rel;
        head = cur.head;
      }
      if (head != null && !placed.has(head)) return { ...u, head: null, rel: 'float' };
      return { ...u, rel, head };
    });
  }

  place(ids) {
    for (const id of ids) this.placed.add(id);
    settle(this.g, this.placed);
  }

  /**
   * The learner clicked a word (the ids of the units under it) or chose the
   * step's "none" answer. Returns feedback: { type, text, ids }.
   */
  answer(choice) {
    const st = this.step;
    if (!st) return null;
    if (choice === 'none') {
      if (!st.none) return null;
      if (st.noneRight) { this.place(st.place || []); return this.complete(st.right); }
      return this.miss(st.noneWrong || 'Something does answer it. Look again.', []);
    }
    const ids = [].concat(choice).filter((id) => this.g.get(id));
    if (!ids.length) return null;
    if (st.kind === 'find') {
      const id = ids.find((x) => this.target(st, x)) ?? ids[0];
      const t = this.target(st, id);
      if (!t) return this.miss(this.why(st, this.g.get(id)), [id]);
      if (st.span) return this.complete(st.right);
      if (this.got.has(t)) return { type: 'hint', text: `You already found ${q(word(this.g, this.g.get(t)))}. Find the other part.`, ids: [id] };
      this.got.add(t);
      this.place([t]);
      const left = st.targets.filter((x) => !this.got.has(x)).length;
      if (!left) return this.complete(st.right, [id]);
      this.narrow = null;
      return { type: 'partial', text: st.partial(left), ids: [id] };
    }
    const id = ids.find((x) => st.heads.has(x)) ?? ids.find((x) => x !== st.unit) ?? ids[0];
    if (st.heads.has(id)) { this.place(st.place); return this.complete(st.right(id), [id]); }
    return this.miss(this.why(st, this.g.get(id)), [id]);
  }

  /** Which of the step's targets a click on unit `id` counts as, if any. */
  target(st, id) {
    if (st.span) return st.span.has(id) ? st.targets[0] : null;
    if (st.targets.includes(id)) return id;
    return st.markOf?.get(id) || null;
  }

  hint() {
    const st = this.step;
    if (!st) return null;
    this.hints++;
    if (this.hints === 1) return { type: 'hint', text: st.tip };
    if (this.hints === 2) {
      this.narrow = this.candidates(st);
      return { type: 'hint', text: st.noneRight ? 'Look at the choices again. Maybe no word answers.' : 'It’s one of the highlighted words.' };
    }
    return { type: 'hint', text: 'Still stuck? “Show me” puts it on the diagram for you.' };
  }

  show() {
    const st = this.step;
    if (!st) return null;
    this.shown = true;
    if (st.kind === 'find') {
      if (!st.span) this.place(st.noneRight ? st.place || [] : st.targets);
      return this.complete(`Here it is. ${st.right}`);
    }
    this.place(st.place);
    const h = [...st.heads][0];
    return this.complete(`Here it is. ${st.noneRight ? st.right : st.right(h)}`);
  }

  /** The right answer and the two nearest wrong ones, for the second hint. */
  candidates(st) {
    const { g } = this;
    const right = st.noneRight ? [] : st.kind === 'find'
      ? st.targets.filter((x) => !this.got.has(x)).slice(0, 1)
      : [...st.heads].slice(0, 1);
    const out = new Set(st.noneRight ? ['none'] : right);
    const anchor = right[0] ? g.order(g.get(right[0])) : g.order(g.get(st.unit || st.home));
    const ok = (u) => !u.understood && !out.has(u.id) && u.id !== st.unit && u.sent === st.sent
      && (st.kind === 'find' ? !this.placed.has(u.id) && !this.target(st, u.id) : this.placed.has(u.id) && !st.heads.has(u.id));
    const near = g.units.filter(ok).sort((a, b) => Math.abs(g.order(a) - anchor) - Math.abs(g.order(b) - anchor));
    for (const u of near.slice(0, 2)) out.add(u.id);
    return out;
  }

  complete(text, ids = []) {
    this.results.push(this.shown ? 'shown' : this.hints ? 'hinted' : this.misses ? 'missed' : 'first');
    this.i++;
    this.resetStep();
    return { type: 'right', text, ids };
  }

  miss(text, ids) {
    this.misses++;
    return { type: 'wrong', text, ids };
  }

  // ---------- explaining a wrong answer ----------

  why(st, c) {
    const { g } = this;
    if (!c) return 'Try another word.';
    if (st.kind === 'attach') return this.whyAttach(st, c);
    const w = q(word(g, c));
    const ask = st.question ? ` Ask: ${st.question}` : '';
    if (st.verbs?.includes(c.id) && st.phase !== 'verb') {
      return st.phase === 'subject' ? `${w} is the verb. The subject answers ${st.question}` : `That's the verb.${ask}`;
    }
    if (this.placed.has(c.id)) return `${w} is already on the diagram: it's ${g.describe(c)}.${ask}`;

    const home = g.get(st.home), mine = clauseOf(g, c);
    if (home && mine && mine.id !== home.id) {
      if (g.dominates(mine, home)) {
        const relPron = st.targets.some((id) => g.get(id).relPron);
        return `${w} isn't in the clause ${q(span(g, home))}. Look inside it.${relPron ? ' Words like who, which and that can stand for a noun.' : ''}`;
      }
      const look = home.rel === 'root' ? (mine.rel === 'conj' ? ' Start with the first clause.' : ' Look in the main clause.') : ` Stay inside ${q(span(g, home))}.`;
      return c.id === mine.id
        ? `${w} is a verb, but it's the verb of ${clauseName(g, mine)}.${look}`
        : `${w} is in ${clauseName(g, mine)}.${look}`;
    }

    const T = st.targets.map((id) => g.get(id));
    const inside = T.find((t) => g.dominates(t, c));
    const phrase = phraseOf(g, c, home);
    switch (st.phase) {
      case 'verb':
        return `${whatIs(g, c)} The verb tells what someone or something does or is.`;
      case 'subject':
        if (st.noneRight) return `${w} doesn't answer ${st.question} Is anyone named who does it?`;
        if (inside) return `${w} is part of the complete subject, ${q(span(g, inside))}, but the simple subject is its main word.`;
        if (phrase) return `${w} is inside the phrase ${q(span(g, phrase))}. The subject is never inside a prepositional phrase.`;
        if (c.rel === 'expl') return `${w} only fills the subject's spot. The real subject comes after the verb.`;
        if (c.rel === 'dobj' || c.rel === 'iobj') return `${w} receives the action, so it's an object. The subject answers ${st.question}`;
        if (c.rel === 'pred') return `${w} completes the verb: it renames or describes the subject. The subject answers ${st.question}`;
        return `${whatIs(g, c)} The subject answers ${st.question}`;
      case 'complement':
        if (phrase) return `${w} is inside the phrase ${q(span(g, phrase))}. Objects and complements are never inside a prepositional phrase.`;
        if (st.noneRight) return `${w} doesn't answer ${st.question} ${whatIs(g, c)}`;
        if (inside) return `${w} is part of ${q(span(g, inside))}. Click its main word.`;
        if (c.rel === 'iobj') return `${w} tells to whom or for whom, so it's the indirect object.${ask}`;
        if (c.rel === 'ocomp') return `${w} renames or describes the object. Find the object first.${ask}`;
        return `${whatIs(g, c)}${ask}`;
      default:
        if (inside) return `${w} is part of ${q(span(g, inside))}. Click its main word.`;
        if (st.phase === 'pobj' && !g.dominates(g.get(st.head), c)) return `${w} isn't in the phrase ${q(span(g, g.get(st.head)))}.`;
        return `${whatIs(g, c)}${ask}`;
    }
  }

  whyAttach(st, c) {
    const { g } = this;
    const U = g.get(st.unit), w = q(word(g, c)), L = st.label;
    if (st.form === 'intj') return `${L} doesn't ${st.verb} ${w}. Does it belong to any word at all?`;
    const verbs = { describe: 'describes', 'tell about': 'tells about', rename: 'renames', 'go with': 'goes with' };
    if (c.id === U.id) return `That's ${L} itself. Click the word it ${verbs[st.verb]}.`;
    if (g.dominates(U, c)) return `${w} is part of ${L}. Which word outside it does it ${st.verb}?`;
    if (!this.placed.has(c.id)) return `${w} isn't on the diagram yet, so ${L} can't hang from it. Pick a word that's already drawn.`;
    const nominal = NOMINAL_POS.has(c.pos);
    switch (st.form) {
      case 'adj':
        if (g.isVerbal(c)) return `${L} describes a person, place or thing, not an action. Which noun does it go with?`;
        return `${L} doesn't describe ${w}. Adjectives and articles usually come right before the noun they describe.`;
      case 'adv':
        if (nominal) return `${L} is an adverb, so it tells about a verb, an adjective or another adverb, not a noun like ${w}.`;
        return `Does ${L} tell how, when, where or how much about ${w}? Try another word.`;
      case 'prep':
        if (nominal) return `Does ${L} tell which ${word(g, c)}, or what kind? If not, it may tell how, when or where about a verb.`;
        if (g.isVerbal(c)) return `Does ${L} tell how, when, where or why about ${w}? If not, it may tell which one about a noun.`;
        return `${L} doesn't tell about ${w}. Try a noun or a verb.`;
      case 'advcl':
        return `An adverb clause tells when, where, why or how. Does ${L} do that for ${w}?`;
      case 'relcl':
        return `${L} doesn't describe ${w}. An adjective clause describes a noun, usually the one right before it.`;
      case 'appos':
        return `${L} doesn't rename ${w}. An appositive renames the noun right beside it.`;
      case 'part':
        return `${L} doesn't describe ${w}. A participle phrase describes a noun, usually one right beside it.`;
      default:
        return `${L} doesn't ${st.verb} ${w}. Read them together: do they make sense as a pair?`;
    }
  }
}
