import nlp from 'compromise';
import {
  COORDINATORS, SUBORDINATORS, WH_WORDS, INTERJECTIONS, BE_FORMS, HAVE_FORMS,
  DO_FORMS, MODALS, ING_NOUNS, PLACE_ADVERBS,
} from './lexicon.js';

const POSSESSIVE_DETS = new Set(['my', 'your', 'his', 'her', 'its', 'our', 'their']);

/**
 * Split text into sentences of tokens with coarse parts of speech.
 * Each token keeps its character span in the original text so the UI can
 * highlight it. Contractions ("don't") become two tokens ("do", "not"); the
 * second one has a zero-length span right after the first.
 */
export function tagText(text) {
  const doc = nlp(text);
  doc.compute('root');
  const json = doc.json({ offset: true, terms: { normal: true } });
  const sentences = [];
  let gi = 0;
  for (const s of json) {
    const terms = s.terms;
    const tokens = [];
    for (let k = 0; k < terms.length; k++) {
      const t = terms[k];
      const tags = new Set(t.tags);
      const implicit = t.implicit && t.implicit.trim();
      let display = implicit || t.text;
      // keep the period on abbreviations: "Mr." "Dr." "St."
      if (!implicit && /^\./.test(t.post || '') && (tags.has('Abbreviation') || tags.has('Honorific')) && k < terms.length - 1) display += '.';
      if (!display) continue;
      const norm = (implicit || t.normal || t.text).toLowerCase().replace(/[^a-z0-9'’-]/g, '');
      const start = t.offset ? t.offset.start : 0;
      const length = t.offset ? t.offset.length : t.text.length;
      tokens.push({
        i: gi++,
        text: display,
        norm,
        lemma: (t.root || norm).toLowerCase(),
        tags,
        start,
        end: start + length,
        post: t.post || '',
        pre: t.pre || '',
        pos: null,
      });
    }
    for (let k = 0; k < tokens.length; k++) tokens[k].pos = coarsePos(tokens, k);
    fixGerunds(tokens);
    markVerbish(tokens);
    if (tokens.length) sentences.push({ tokens, end: s.terms.at(-1)?.post || '' });
  }
  return sentences;
}

function coarsePos(tokens, k) {
  const t = tokens[k];
  const { tags, norm } = t;
  const next = tokens[k + 1];
  const commaOrBang = /[,!]/.test(t.post);

  if (norm === 'to') return 'TO';
  if (/^(and|or|but|nor)$/.test(norm)) return 'CCONJ';
  // "no Person": a determiner, not the interjection
  if (norm === 'no' && next && /Noun|Adjective/.test([...next.tags].join())) return 'DET';
  if (norm === 'that') return 'THAT';
  if (norm === 'please') return commaOrBang ? 'INTJ' : 'ADV';
  if (WH_WORDS.has(norm)) return 'WH';
  if (tags.has('Expression')) return 'INTJ';
  if (INTERJECTIONS.has(norm) && k === 0 && commaOrBang) return 'INTJ';
  if (norm === 'there' && next && BE_FORMS.has(next.norm)) return 'EXPL';
  if (POSSESSIVE_DETS.has(norm)) {
    // "her" is either possessive ("her book") or an object ("saw her").
    const nextNominal = next && /Noun|Adjective|Value/.test([...next.tags].join()) && !next.tags.has('Date');
    if (norm === 'her' ? nextNominal : nextNominal || norm !== 'his') return 'POSS';
    return 'PRON';
  }
  if (tags.has('Possessive') && !tags.has('Pronoun')) return 'POSS';
  if (tags.has('Determiner')) return 'DET';
  if (tags.has('Pronoun')) return 'PRON';
  if (tags.has('Negative') || norm === 'not' || norm === "n't") return 'NEG';
  if (MODALS.has(norm) && (tags.has('Verb') || tags.has('Modal'))) return 'MODAL';
  if (tags.has('Particle')) return 'PART';
  if (tags.has('Verb') && (BE_FORMS.has(norm) || HAVE_FORMS.has(norm) || DO_FORMS.has(norm))) return 'AUX';
  if (tags.has('Preposition')) return 'PREP';
  if (tags.has('Conjunction')) {
    if (COORDINATORS.has(norm)) return 'CCONJ';
    if (SUBORDINATORS.has(norm)) return 'SCONJ';
    return 'CCONJ';
  }
  if (tags.has('Verb')) return 'VERB';
  if (tags.has('Adjective')) {
    if (PLACE_ADVERBS.has(norm) && !(next && /Noun|Adjective|Determiner/.test([...next.tags].join()))) return 'ADV';
    return 'ADJ';
  }
  if (tags.has('Adverb')) return 'ADV';
  if (tags.has('Value') || tags.has('Cardinal') || tags.has('Ordinal')) return 'NUM';
  if (tags.has('ProperNoun')) return 'PROPN';
  if (tags.has('Noun')) return 'NOUN';
  if (/ly$/.test(norm)) return 'ADV';
  return 'NOUN';
}

// "Swimming is fun": compromise calls "Swimming" a noun. When an -ing noun has
// no determiner or adjective in front of it, read it as a gerund.
function fixGerunds(tokens) {
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.pos !== 'NOUN' || !/ing$/.test(t.norm) || ING_NOUNS.has(t.norm) || t.norm.length < 5) continue;
    const prev = tokens[k - 1];
    if (prev && /DET|POSS|ADJ|NUM/.test(prev.pos)) continue;
    t.pos = 'VERB';
    t.tags.add('Gerund');
  }
}

// "stay home and play games": after a conjunction, a "noun" followed by an
// object may really be a verb. Flag the ones compromise reads as verbs when
// given a subject, and let the parser decide.
function markVerbish(tokens) {
  for (let k = 1; k < tokens.length - 1; k++) {
    const t = tokens[k];
    if (t.pos !== 'NOUN' || tokens[k - 1].pos !== 'CCONJ' || !/NOUN|DET|PRON|POSS|PROPN|NUM|ADJ/.test(tokens[k + 1].pos)) continue;
    const probe = nlp(`they ${t.norm}`).json()[0]?.terms[1];
    if (probe && probe.tags.includes('Verb')) t.verbish = true;
  }
}

export const isGerund = (t) => t && t.pos === 'VERB' && t.tags.has('Gerund');
export const isBase = (t) => t && t.tags.has('Infinitive');
export const isBeForm = (t) => t && BE_FORMS.has(t.norm);
