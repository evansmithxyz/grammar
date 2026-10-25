import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/nlp/parser.js';
import { Graph } from '../src/model/graph.js';
import { layoutGraph } from '../src/diagram/layout.js';
import { reattach, setRelation, detach, mergeNext, split } from '../src/model/edit.js';

const measure = (text) => text.length * 10;

// Odd and messy input: none of it may throw, and every word must be drawn.
const INPUTS = [
  'Run.', 'Dogs.', 'Hello!', '42.', '...', 'the', 'and and and', 'Yes, no, maybe.',
  'The old man the boats.', 'Buffalo buffalo Buffalo buffalo buffalo buffalo Buffalo buffalo.',
  'Time flies like an arrow; fruit flies like a banana.',
  'I saw the man with the telescope.', 'Colorless green ideas sleep furiously.',
  'She said, "I will be there at 5:30 p.m. tomorrow."', 'It costs $3.50, right?',
  'My favorite emoji is 🎉 and I use it a lot.',
  'This is the first sentence. This is the second one! And a third?',
  'Although the weather was terrible and the roads were icy, the team that had trained all year drove for six hours, arrived late, and still won the championship because they never gave up.',
  'Whoever wins the race will receive a medal.', 'What a beautiful day it is!',
  'Having finished his homework, Tom went outside to play with his friends.',
  'The more you practice, the better you get.', 'Neither the teacher nor the students knew the answer.',
  'Not only did she sing, but she also danced.', 'Is it raining?', 'Where are my keys?',
  "Let's go to the park.", 'Please, sit down.', 'To be or not to be, that is the question.',
  'He is taller than his brother.', 'I have been waiting for you since noon.',
  'The books on the shelf in the corner of the room are mine.', 'Go!', 'Oh no!',
];

for (const text of INPUTS) {
  test(`robust: ${text.slice(0, 60)}`, () => {
    const { tokens, units } = parse(text);
    const g = new Graph(tokens, units);
    const { prims } = layoutGraph(g, measure);
    const drawn = new Set(prims.filter((p) => p.t === 'text').map((p) => p.uid));
    for (const u of units) assert.ok(drawn.has(u.id), `“${g.text(u)}” is drawn`);
    for (const p of prims) {
      const nums = p.t === 'text' ? [p.x, p.y] : p.t === 'line' ? [p.x1, p.y1, p.x2, p.y2] : p.pts.flat();
      assert.ok(nums.every(Number.isFinite), 'finite coordinates');
    }
    // every head points at a real unit and there are no cycles
    for (const u of units) {
      if (u.head != null) assert.ok(g.get(u.head), 'head exists');
      let n = 0;
      for (let c = u; c; c = g.head(c)) assert.ok(++n < 200, 'no cycles');
    }
  });
}

test('edits keep the graph valid and drawable', () => {
  const { tokens, units } = parse('The quick brown fox jumped over the lazy dog in New York.');
  let us = units;
  const g0 = new Graph(tokens, us);
  const id = (t) => us.find((u) => new Graph(tokens, us).text(u) === t).id;
  const steps = [
    (u) => reattach(u, tokens, id('over'), id('fox'), 'prep'),
    (u) => setRelation(u, tokens, id('lazy'), 'pred'),
    (u) => detach(u, id('quick')),
    (u) => mergeNext(u, tokens, id('brown')),
    (u) => split(u, tokens, id('brown fox')),
    (u) => setRelation(u, tokens, id('dog'), 'root'),
  ];
  assert.ok(g0.units.length > 0);
  for (const step of steps) {
    const r = step(us);
    assert.ok(!r.error, r.error);
    us = r.units;
    const g = new Graph(tokens, us);
    const { prims } = layoutGraph(g, measure);
    const drawn = new Set(prims.filter((p) => p.t === 'text').map((p) => p.uid));
    for (const u of us) assert.ok(drawn.has(u.id), `“${g.text(u)}” is drawn after edit`);
    for (const u of us) { let n = 0; for (let c = u; c; c = g.head(c)) assert.ok(++n < 200, 'no cycles'); }
  }
  // joining a modifier with its head keeps the head's job
  const gEnd = new Graph(tokens, us);
  assert.ok(!us.some((u) => gEnd.text(u) === 'brown fox'), 'split undid the merge');
  assert.equal(us.find((u) => new Graph(tokens, us).text(u) === 'fox').rel, 'subj');
  // cycles are refused
  const r = reattach(us, tokens, id('in'), id('New York'), 'mod');
  assert.ok(r.error, 'attaching a word to its own modifier is refused');
});
