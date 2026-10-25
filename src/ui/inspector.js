import { RELATIONS, relationChoices } from '../model/graph.js';
import { unitFamily } from '../diagram/themes.js';

const POS_NAMES = {
  NOUN: 'noun', PROPN: 'proper noun', PRON: 'pronoun', VERB: 'verb', AUX: 'helping verb', MODAL: 'helping verb',
  ADJ: 'adjective', ADV: 'adverb', DET: 'article / determiner', POSS: 'possessive', NUM: 'number', PREP: 'preposition',
  TO: 'to', CCONJ: 'coordinating conjunction', SCONJ: 'subordinating conjunction', WH: 'wh-word', THAT: 'that',
  INTJ: 'interjection', NEG: 'negative', PART: 'particle', EXPL: 'expletive',
};

// What each role looks like on a Reed–Kellogg diagram.
const TIPS = {
  root: 'The verb sits on the baseline, right of the subject, behind a divider that cuts through the line.',
  subj: 'The subject comes first on the baseline. A vertical line that crosses the baseline separates it from the verb.',
  dobj: 'Direct objects follow the verb on the baseline, behind a short vertical line that stops at the baseline.',
  iobj: 'Indirect objects hang under the verb like a prepositional phrase with an invisible preposition.',
  pred: 'Subject complements follow a linking verb behind a line that slants back toward the subject.',
  ocomp: 'Object complements follow the direct object behind a line that slants back toward the object.',
  mod: 'Modifiers go on slanted lines beneath the word they modify.',
  prep: 'A prepositional phrase hangs under the word it modifies: the preposition on a slant, its object on a flat line.',
  pobj: 'The object of a preposition sits on the flat line at the foot of the preposition’s slant.',
  npadv: 'A noun used as an adverb hangs under the verb, often on an empty slant.',
  appos: 'An appositive sits in parentheses right beside the noun it renames.',
  conj: 'Compound parts split the line into a fork; a dashed line carries the conjunction.',
  cc: 'Conjunctions ride on the dashed line that joins compound parts.',
  mark: 'Subordinators sit on the dashed line joining a clause to the word it modifies (or float above a noun clause).',
  advcl: 'An adverb clause gets its own baseline below, tied to the verb it modifies by a dashed line.',
  relcl: 'An adjective clause gets its own baseline below; a dashed line runs from the noun to the relative pronoun.',
  intj: 'Independent elements float on their own line above the sentence, attached to nothing.',
  expl: 'Expletives like “there” float above the baseline; the real subject comes after the verb.',
  float: 'Unattached words float above the diagram. Drag one onto the word it belongs to.',
};

export class Inspector {
  constructor(root, actions) {
    this.root = root;
    this.a = actions;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const { act, rel } = b.dataset;
      if (act === 'rel') this.a.setRelation(this.uid, rel);
      else if (act === 'merge') this.a.merge(this.uid);
      else if (act === 'split') this.a.split(this.uid);
      else if (act === 'detach') this.a.detach(this.uid);
      else if (act === 'close') this.a.select(null);
    });
    root.addEventListener('change', (e) => {
      if (e.target.id === 'insp-head') {
        const v = e.target.value;
        if (v === '__none') this.a.detach(this.uid);
        else this.a.reattach(this.uid, v);
      }
    });
  }

  render(g, uid, mode, allowedHeads = null) {
    this.uid = uid;
    const u = uid && g ? g.get(uid) : null;
    if (mode === 'guided') return this.guidedHelp(this.phase ?? 0);
    if (mode === 'practice') return this.practiceHelp();
    if (mode === 'scratch' && !u) return this.scratchHelp();
    if (!u) return this.help(g);
    const h = g.head(u);
    const fam = unitFamily(g, u);
    const rel = RELATIONS[u.rel] || RELATIONS.float;
    const choices = relationChoices(g, u, h);
    if (!choices.includes(u.rel)) choices.unshift(u.rel);
    // in scratch mode, only words already on the board can take it
    const others = g.units.filter((x) => x.id !== u.id && !g.dominates(u, x) && (!allowedHeads || allowedHeads.has(x.id)));
    const nextTok = u.tokens.length ? Math.max(...u.tokens) + 1 : -1;
    const canMerge = g.units.some((x) => x.tokens.includes(nextTok) && x.sent === u.sent);
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

    this.root.innerHTML = `
      <p class="eyebrow">Selected word</p>
      <h3>${esc(g.text(u))}</h3>
      <div class="tags">
        <span class="tag role f-${fam}">${esc(rel.label.toLowerCase())}</span>
        ${(POS_NAMES[u.pos] || u.pos.toLowerCase()) !== rel.label.toLowerCase() ? `<span class="tag">${esc(POS_NAMES[u.pos] || u.pos.toLowerCase())}</span>` : ''}
        ${u.understood ? '<span class="tag">understood</span>' : ''}
      </div>
      <p>“${esc(g.text(u))}” is ${esc(g.describe(u))}.</p>
      <span class="label">Its job</span>
      <div class="roles">
        ${choices.map((r) => `<button data-act="rel" data-rel="${r}" aria-pressed="${r === u.rel}">${esc(RELATIONS[r].label)}</button>`).join('')}
      </div>
      <label class="label" for="insp-head">Attached to</label>
      <select id="insp-head">
        <option value="__none" ${!h ? 'selected' : ''}>nothing (floating)</option>
        ${others.map((x) => `<option value="${x.id}" ${h && x.id === h.id ? 'selected' : ''}>${esc(g.text(x))}${x.understood ? ' (understood)' : ''}</option>`).join('')}
      </select>
      <div class="row">
        ${canMerge && !u.understood ? '<button class="btn ghost" data-act="merge" title="Treat this and the next word as one">Join next word</button>' : ''}
        ${u.tokens.length > 1 ? '<button class="btn ghost" data-act="split" title="Break into separate words">Split</button>' : ''}
        ${h ? '<button class="btn ghost" data-act="detach">Detach</button>' : ''}
        <button class="btn ghost" data-act="close">Done</button>
      </div>
      <div class="tip"><b>On the diagram.</b> ${TIPS[u.rel] || TIPS.mod}</div>
    `;
  }

  help(g) {
    const floats = g ? g.units.filter((u) => u.rel === 'float').length : 0;
    this.root.innerHTML = `
      <p class="eyebrow">No word selected</p>
      <h3>Fix the parse by hand</h3>
      <p>The parser sometimes guesses wrong. You can correct it.</p>
      <ul>
        <li><b>Drag</b> a word onto another word to make it hang from that word.</li>
        <li><b>Click</b> a word to see its job and change it.</li>
        <li><b>Hover</b> a word to find it in the sentence.</li>
        <li><kbd>Ctrl</kbd> <kbd>Z</kbd> undoes. <kbd>Esc</kbd> deselects.</li>
      </ul>
      ${floats ? `<div class="tip"><b>${floats} unattached word${floats > 1 ? 's' : ''}</b> float${floats > 1 ? '' : 's'} above the diagram. Drag ${floats > 1 ? 'them' : 'it'} into place.</div>` : '<div class="tip"><b>Ambiguous?</b> “I saw the man with the telescope” can hang <i>with</i> on <i>saw</i> or on <i>man</i>. Try both.</div>'}
    `;
  }

  scratchHelp() {
    this.root.innerHTML = `
      <p class="eyebrow">From scratch</p>
      <h3>Build the diagram</h3>
      <p>Every word starts in the tray under the board.</p>
      <ul>
        <li><b>Start the baseline:</b> drag the main verb onto the board.</li>
        <li><b>Add words:</b> drag each word onto the word it belongs to, then pick its job.</li>
        <li><b>Join with a conjunction:</b> drop “and” or “but” on the first part, then drop the next part on the conjunction. For a second clause, that’s its verb; its subject goes on the verb.</li>
        <li><b>Change your mind:</b> drag a word onto a different word, or back to the tray.</li>
        <li><b>Check</b> outlines each word in green or red.</li>
      </ul>
      <div class="tip"><b>Answers come from the parser.</b> The built-in examples are reliable; on your own sentences the parser can be wrong too.</div>
    `;
  }

  /** The classroom method, with the learner's place in it (`phase` 0–4, 5 when done). */
  guidedHelp(phase) {
    const steps = [
      'Find the verb.',
      'Find the subject: ask “who or what?” before the verb.',
      'Find what completes the verb: ask “whom or what?” after it.',
      'Hang each other word under the word it tells about.',
      'Do the same for every clause.',
    ];
    this.root.innerHTML = `
      <p class="eyebrow">Guided</p>
      <h3>Diagram it step by step</h3>
      <p>Answer each question by clicking a word, under the board, in the sentence above or on the diagram. The diagram builds itself as you go.</p>
      <ol class="method">
        ${steps.map((s, k) => `<li class="${phase === 5 || k < Math.min(phase, 3) ? 'done' : k === phase ? 'now' : ''}">${s}</li>`).join('')}
      </ol>
      <div class="tip"><b>Stuck?</b> Hint tells you what to ask yourself. Press it again and it narrows the choices. Show me puts the answer on the diagram.</div>
    `;
  }

  practiceHelp() {
    this.root.innerHTML = `
      <p class="eyebrow">Practice</p>
      <h3>Fill in the diagram</h3>
      <p>The lines are drawn; the words are missing. Drag each tile onto the slot where it belongs, then check your work.</p>
      <ul>
        <li>The divider that crosses the baseline sits between <b>subject</b> and <b>verb</b>.</li>
        <li>Slanted lines hold <b>modifiers</b>. A slant ending in a flat line is a <b>prepositional phrase</b>.</li>
        <li>Click a filled slot to send its word back.</li>
      </ul>
    `;
  }
}
