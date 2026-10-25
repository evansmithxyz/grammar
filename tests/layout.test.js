import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/nlp/parser.js';
import { Graph } from '../src/model/graph.js';
import { layoutGraph } from '../src/diagram/layout.js';
import { EXAMPLES } from '../src/examples.js';
import { measure, assertLegible } from './geometry.js';

const EXTRA = [
  'I came, I saw, I conquered.',
  'The very old man and his young grandson fished quietly in the deep blue lake.',
  'If it rains tomorrow, we will stay inside and play games.',
  'The house in which I live is old.',
  'I told her that he left.',
  'She is afraid of the dark.',
  'To err is human.',
  'My dog and my cat sleep on the couch.',
  'I wonder whether it will rain.',
  'The cake baked by my mom was delicious.',
  'Mr. Smith teaches math at the high school.',
  'What is that?',
  'How old are you?',
  'Judgment in Cases of Impeachment shall not extend further than to removal from Office, and disqualification to hold and enjoy any Office of honor, Trust or Profit under the United States: but the Party convicted shall nevertheless be liable and subject to Indictment, Trial, Judgment and Punishment, according to Law.',
  'They wanted to hold and to enjoy the office.',
  'She likes to swim and dive in the lake.',
  'The Senate shall have the sole Power to try all Impeachments. When sitting for that Purpose, they shall be on Oath or Affirmation. When the President of the United States is tried, the Chief Justice shall preside: And no Person shall be convicted without the Concurrence of two thirds of the Members present.',
];


for (const text of [...EXAMPLES.map((e) => e.text), ...EXTRA]) {
  test(`layout: ${text}`, () => {
    const { tokens, units } = parse(text);
    const g = new Graph(tokens, units);
    const { prims, bounds } = layoutGraph(g, measure);
    for (const v of Object.values(bounds)) assert.ok(Number.isFinite(v), 'bounds are finite');
    const words = prims.filter((p) => p.t === 'text');
    // examples are curated: the parser should place every word
    if (EXAMPLES.some((e) => e.text === text)) {
      const loose = units.filter((u) => u.rel === 'float').map((u) => g.text(u));
      assert.deepEqual(loose, [], 'no unattached words in examples');
    }
    // every unit is drawn
    const drawn = new Set(words.map((p) => p.uid));
    for (const u of units) assert.ok(drawn.has(u.id), `“${g.text(u)}” is drawn`);
    assertLegible(prims);
  });
}

test('a phrase is drawn once even when its preposition is tagged as a conjunction', () => {
  // spaCy tags "except" and "because" as conjunctions when they head a phrase;
  // the phrase's object used to be drawn at the foot of the slant and again under it
  const { tokens, units } = parse('She went to the store.');
  const g0 = new Graph(tokens, units);
  const tagged = units.map((u) => (g0.text(u) === 'to' ? { ...u, pos: 'SCONJ' } : u));
  const g = new Graph(tokens, tagged);
  const { prims } = layoutGraph(g, measure);
  assert.equal(prims.filter((p) => p.t === 'text' && p.text === 'store').length, 1);
  assertLegible(prims);
});
