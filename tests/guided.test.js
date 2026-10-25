import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from '../src/nlp/parser.js';
import { fromSpacy } from '../src/nlp/spacy.js';
import { Graph } from '../src/model/graph.js';
import { Guide } from '../src/model/guided.js';
import { layoutGraph } from '../src/diagram/layout.js';
import { EXAMPLES } from '../src/examples.js';
import { measure } from './geometry.js';

const FIXTURE = new URL('./fixtures/spacy.json', import.meta.url);
const spacy = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : {};

const setup = (text) => {
  const { tokens, units } = parse(text);
  const gd = new Guide(tokens, units);
  const id = (t, k = 0) => units.filter((u) => gd.g.text(u) === t)[k].id;
  return { gd, id, units, tokens };
};

/** Answer every step correctly. */
function playRight(gd) {
  for (let n = 0; !gd.done && n < 500; n++) {
    const st = gd.step;
    if (st.noneRight) gd.answer('none');
    else if (st.kind === 'find') for (const t of st.targets) gd.answer([t]);
    else gd.answer([[...st.heads][0]]);
  }
}

/** Every attached word ends up on the board, exactly where the answer key has it. */
function assertComplete(gd, units, label) {
  assert.ok(gd.done, `${label}: didn't finish`);
  const built = new Map(gd.units().map((u) => [u.id, u]));
  for (const u of units) {
    if (u.rel === 'float') continue;
    assert.ok(gd.placed.has(u.id), `${label}: “${gd.g.text(u)}” never placed`);
    assert.equal(built.get(u.id).head, u.head, `${label}: “${gd.g.text(u)}” hangs from the wrong word`);
    assert.equal(built.get(u.id).rel, u.rel, `${label}: “${gd.g.text(u)}” has the wrong job`);
  }
}

for (const { text } of EXAMPLES) {
  test(`guided: answering every step builds the whole diagram — ${text}`, () => {
    const { gd, units } = setup(text);
    playRight(gd);
    assertComplete(gd, units, text);
    assert.ok(gd.results.every((r) => r === 'first'));
  });
}

for (const [text, data] of Object.entries(spacy)) {
  test(`guided: a spaCy parse plays through — ${text.slice(0, 60)}`, () => {
    const { tokens, units } = fromSpacy(text, data);
    const gd = new Guide(tokens, units);
    playRight(gd);
    assertComplete(gd, units, text);
  });
}

test('the main clause comes first: verb, subject, then what completes the verb', () => {
  const { gd } = setup('When the bell rang, the students left quickly.');
  assert.deepEqual(gd.steps.slice(0, 3).map((s) => s.phase), ['verb', 'subject', 'complement']);
  assert.equal(gd.g.text(gd.g.get(gd.steps[0].targets[0])), 'left');
});

test('a half-built diagram lays out at every step', () => {
  const { gd, tokens } = setup('The girl with the red hat sang a song to her mother.');
  for (let n = 0; !gd.done && n < 100; n++) {
    const built = new Graph(tokens, gd.units().filter((u) => gd.placed.has(u.id)));
    if (built.units.length) layoutGraph(built, measure);
    const st = gd.step;
    if (st.noneRight) gd.answer('none');
    else if (st.kind === 'find') gd.answer(st.targets.slice(0, 1));
    else gd.answer([[...st.heads][0]]);
  }
  assert.ok(gd.done);
});

test('wrong answers are explained by what the word really does', () => {
  const { gd, id } = setup('The quick brown fox jumped over the lazy dog.');
  let fb = gd.answer([id('fox')]);
  assert.equal(fb.type, 'wrong');
  assert.match(fb.text, /noun/);
  gd.answer([id('jumped')]);
  fb = gd.answer([id('dog')]);
  assert.match(fb.text, /never inside a prepositional phrase/);
  fb = gd.answer([id('quick')]);
  assert.match(fb.text, /complete subject/);
  assert.equal(gd.answer([id('fox')]).type, 'right');
  // nothing answers "jumped what?"
  fb = gd.answer('none');
  assert.equal(fb.type, 'right');
  // "the" before "fox" can't hang from a verb
  fb = gd.answer([id('jumped')]);
  assert.match(fb.text, /not an action/);
  assert.equal(gd.results.join(), 'missed,missed,first');
});

test('a verb from another clause is pointed out as such', () => {
  const { gd, id } = setup('When the bell rang, the students left quickly.');
  const fb = gd.answer([id('rang')]);
  assert.match(fb.text, /verb of the clause “when the bell rang”/);
});

test('a compound is found part by part, and a part found first stands in for the whole', () => {
  const { gd, id } = setup('John and Mary washed the car.');
  gd.answer([id('washed')]);
  assert.equal(gd.answer([id('Mary')]).type, 'partial');
  const mary = gd.units().find((u) => u.id === id('Mary'));
  assert.equal(mary.rel, 'subj');
  assert.equal(mary.head, id('washed'));
  assert.ok(!gd.placed.has(id('and')), 'the conjunction waits for both parts');
  assert.equal(gd.answer([id('John')]).type, 'right');
  assert.ok(gd.placed.has(id('and')));
  assert.equal(gd.units().find((u) => u.id === id('Mary')).rel, 'conj');
});

test('an understood subject is answered with “it isn’t written”', () => {
  const { gd, units } = setup("Don't touch the stove!");
  gd.answer([gd.steps[0].targets[0]]);
  assert.equal(gd.step.phase, 'subject');
  assert.equal(gd.answer([units.find((u) => gd.g.text(u) === 'stove').id]).type, 'wrong');
  assert.equal(gd.answer('none').type, 'right');
  assert.ok(gd.placed.has(units.find((u) => u.understood).id));
});

test('a clause used as an object is found by any of its words, then by its verb', () => {
  const { gd, id } = setup('I know that he is right.');
  gd.answer([id('know')]);
  gd.answer([id('I')]);
  assert.ok(gd.step.span);
  assert.equal(gd.answer([id('he')]).type, 'right');
  assert.ok(!gd.placed.has(id('is')));
  assert.equal(gd.step.phase, 'verb');
  assert.equal(gd.answer([id('is')]).type, 'right');
  assert.ok(gd.placed.has(id('that')), 'the subordinator comes with its verb');
});

test('hints: first the strategy, then three choices, then Show me finishes the step', () => {
  const { gd, id } = setup('The quick brown fox jumped over the lazy dog.');
  assert.match(gd.hint().text, /what is happening/);
  gd.hint();
  assert.equal(gd.narrow.size, 3);
  assert.ok(gd.narrow.has(id('jumped')));
  const fb = gd.show();
  assert.equal(fb.type, 'right');
  assert.ok(gd.placed.has(id('jumped')));
  assert.deepEqual(gd.results, ['shown']);
});

test('an interjection belongs to no word', () => {
  const { gd, id } = setup('Wow, that was amazing!');
  for (let n = 0; n < 20 && gd.step && gd.step.form !== 'intj'; n++) {
    const st = gd.step;
    if (st.noneRight) gd.answer('none');
    else if (st.kind === 'find') gd.answer(st.targets);
    else gd.answer([[...st.heads][0]]);
  }
  assert.equal(gd.step.form, 'intj');
  assert.equal(gd.answer([id('was')]).type, 'wrong');
  assert.equal(gd.answer('none').type, 'right');
});
