import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../src/nlp/parser.js';
import { fromSpacy } from '../src/nlp/spacy.js';
import { Graph } from '../src/model/graph.js';
import { Guide } from '../src/model/guided.js';
import { layoutGraph } from '../src/diagram/layout.js';
import { LEVELS, findLesson } from '../src/levels.js';
import { measure, assertLegible } from './geometry.js';

// spaCy's answers, recorded by scripts/capture-spacy.mjs
const spacy = JSON.parse(readFileSync(new URL('./fixtures/levels.json', import.meta.url), 'utf8'));

const facts = (g) => g.units.map((u) => `${u.rel}(${u.head ? g.text(g.get(u.head)) : ''})=${g.text(u)}`.toLowerCase()).sort();

function playRight(gd) {
  for (let n = 0; !gd.done && n < 300; n++) {
    const st = gd.step;
    if (st.noneRight) gd.answer('none');
    else if (st.kind === 'find') for (const t of st.targets) gd.answer([t]);
    else gd.answer([[...st.heads][0]]);
  }
  return gd.done;
}

test('levels: every level has a title, a description and at least five sentences', () => {
  for (const level of LEVELS) {
    assert.ok(level.id && level.title && level.about, `level ${level.id} is described`);
    assert.ok(level.sentences.length >= 5, `${level.title} has enough sentences`);
  }
  const all = LEVELS.flatMap((l) => l.sentences);
  assert.equal(new Set(all).size, all.length, 'no sentence is in two levels');
  assert.equal(new Set(LEVELS.map((l) => l.id)).size, LEVELS.length, 'level ids are unique');
});

test('levels: a sentence finds its level and place', () => {
  const lesson = findLesson(LEVELS[2].sentences[3]);
  assert.equal(lesson.level.id, LEVELS[2].id);
  assert.equal(lesson.index, 3);
  assert.equal(findLesson('Not a level sentence.'), null);
});

for (const level of LEVELS) {
  for (const text of level.sentences) {
    test(`levels: ${level.title}: ${text}`, () => {
      // the lesson's answer is the same whichever parser the site uses
      const R = parse(text);
      const gr = new Graph(R.tokens, R.units);
      assert.ok(spacy[text], 'recorded spaCy parse (run scripts/capture-spacy.mjs)');
      const S = fromSpacy(text, spacy[text]);
      const gs = new Graph(S.tokens, S.units);
      assert.deepEqual(facts(gr), facts(gs), 'the built-in parser and spaCy agree');
      for (const [g, units, tokens] of [[gr, R.units, R.tokens], [gs, S.units, S.tokens]]) {
        assert.deepEqual(units.filter((u) => u.rel === 'float').map((u) => g.text(u)), [], 'every word is attached');
        assertLegible(layoutGraph(g, measure).prims);
        assert.ok(playRight(new Guide(tokens, units)), 'guided mode plays through');
      }
    });
  }
}
