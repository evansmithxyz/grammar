import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/nlp/parser.js';
import { Graph } from '../src/model/graph.js';
import { blank, attachedIds, makeRoot, detachTree, jobChoices, grade, joinAt } from '../src/model/scratch.js';
import { reattach } from '../src/model/edit.js';
import { layoutGraph } from '../src/diagram/layout.js';
import { measure, assertLegible } from './geometry.js';

const setup = (text) => {
  const { tokens, units } = parse(text);
  const g = new Graph(tokens, units);
  const id = (t) => units.find((u) => g.text(u) === t).id;
  return { tokens, key: units, id };
};
const counts = (m) => [...m.values()].reduce((c, v) => ({ ...c, [v]: (c[v] || 0) + 1 }), {});

test('a blank start has every word unplaced', () => {
  const { tokens, key } = setup('The dog barked.');
  const work = blank(key);
  assert.equal(attachedIds(work).size, 0);
  assert.deepEqual(counts(grade(work, key, tokens)), { unplaced: key.length });
});

test('building the answer word by word grades as all right', () => {
  const { tokens, key } = setup('The quick brown fox jumped over the lazy dog.');
  let work = blank(key);
  const root = key.find((u) => u.rel === 'root');
  work = makeRoot(work, root.id).units;
  // attach in an order where each head is already on the board
  const pending = key.filter((u) => u.head != null);
  while (pending.length) {
    const on = attachedIds(work);
    const k = pending.findIndex((u) => on.has(u.head));
    const u = pending.splice(k, 1)[0];
    work = work.map((w) => (w.id === u.id ? { ...w, head: u.head, rel: u.rel } : w));
  }
  assert.deepEqual(counts(grade(work, key, tokens)), { right: key.length });
});

test('compound parts in either order, and the conjunction on either part, count as right', () => {
  const { tokens, key, id } = setup('John and Mary washed the car.');
  const verb = id('washed');
  let work = makeRoot(blank(key), verb).units;
  const set = (uid, head, rel) => { work = work.map((w) => (w.id === uid ? { ...w, head, rel } : w)); };
  set(id('Mary'), verb, 'subj'); // Mary first this time
  set(id('John'), id('Mary'), 'conj');
  set(id('and'), id('Mary'), 'cc');
  set(id('car'), verb, 'dobj');
  set(id('the'), id('car'), 'mod');
  assert.deepEqual(counts(grade(work, key, tokens)), { right: key.length });
});

test('a wrong job or head is wrong for that word only', () => {
  const { tokens, key, id } = setup('The dog chased the cat.');
  const verb = id('chased');
  let work = makeRoot(blank(key), verb).units;
  const set = (uid, head, rel) => { work = work.map((w) => (w.id === uid ? { ...w, head, rel } : w)); };
  set(id('dog'), verb, 'subj');
  set(id('cat'), verb, 'pred'); // should be the direct object
  const result = grade(work, key, tokens);
  assert.equal(result.get(id('dog')), 'right');
  assert.equal(result.get(id('cat')), 'wrong');
  assert.equal(result.get(id('chased')), 'right');
  assert.equal(result.get(id('The')), 'unplaced');
});

test('sending a word back takes what hangs from it too', () => {
  const { key, id } = setup('The dog chased the cat.');
  const verb = id('chased');
  let work = makeRoot(blank(key), verb).units;
  work = work.map((w) => (w.id === id('dog') ? { ...w, head: verb, rel: 'subj' } : w.id === id('The') ? { ...w, head: id('dog'), rel: 'mod' } : w));
  work = detachTree(work, id('dog')).units;
  assert.deepEqual([...attachedIds(work)], [verb]);
});

test('one main verb per sentence', () => {
  const { key, id } = setup('The dog chased the cat.');
  const work = makeRoot(blank(key), id('chased')).units;
  assert.ok(makeRoot(work, id('dog')).error);
});

test('the right job is always offered, in a fixed order', () => {
  const { tokens, key, id } = setup('She gave her brother a book.');
  const work = makeRoot(blank(key), id('gave')).units;
  const keyRel = key.find((u) => u.id === id('brother')).rel;
  const choices = jobChoices(work, tokens, id('brother'), id('gave'), keyRel);
  assert.ok(choices.includes(keyRel));
  assert.ok(choices.indexOf('subj') < choices.indexOf('dobj'));
});

test('a half-built diagram still lays out', () => {
  const { tokens, key, id } = setup('When the bell rang, the students left quickly.');
  let work = makeRoot(blank(key), id('left')).units;
  work = work.map((w) => (w.id === id('rang') ? { ...w, head: id('left'), rel: 'advcl' } : w));
  const on = attachedIds(work);
  const g = new Graph(tokens, work.filter((u) => on.has(u.id)));
  const { prims } = layoutGraph(g, measure);
  assert.ok(prims.some((p) => p.text === 'rang'));
});

test('a compound sentence can be built conjunction first', () => {
  // "and" goes on before the clause it joins: it waits under "sang" instead
  // of floating, and the verb dropped on it becomes the second clause's verb
  const { tokens, key, id } = setup('She sang, and he played the piano.');
  const drawn = (work) => {
    const on = attachedIds(work);
    const { prims } = layoutGraph(new Graph(tokens, work.filter((u) => on.has(u.id))), measure);
    assert.ok(!prims.some((p) => p.kind === 'loose'), 'nothing floats loose');
    assertLegible(prims);
    return prims;
  };
  let work = makeRoot(blank(key), id('sang')).units;
  work = reattach(work, tokens, id('She'), id('sang'), 'subj').units;
  work = reattach(work, tokens, id('and'), id('sang'), 'cc').units;
  assert.ok(drawn(work).some((p) => p.t === 'text' && p.text === 'and'), 'the waiting conjunction is drawn');

  const wrongKind = joinAt(work, tokens, id('he'), id('and'));
  assert.match(wrongKind.error, /joins “sang” to another verb/);
  assert.equal(wrongKind.units, work, 'nothing changes');

  work = joinAt(work, tokens, id('played'), id('and')).units;
  assert.equal(work.find((u) => u.id === id('played')).rel, 'conj');
  assert.equal(work.find((u) => u.id === id('and')).head, id('played'), 'the conjunction moves to the part it introduces');
  drawn(work);
  work = reattach(work, tokens, id('he'), id('played'), 'subj').units;
  work = reattach(work, tokens, id('piano'), id('played'), 'dobj').units;
  work = reattach(work, tokens, id('the'), id('piano'), 'mod').units;
  drawn(work);
  assert.ok([...grade(work, key, tokens).values()].every((v) => v === 'right'));
});
