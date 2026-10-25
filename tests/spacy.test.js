import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fromSpacy } from '../src/nlp/spacy.js';
import { Graph } from '../src/model/graph.js';
import { layoutGraph } from '../src/diagram/layout.js';
import { measure, assertLegible } from './geometry.js';

// Real answers from the parse server, recorded by scripts/capture-spacy.mjs.
const FIXTURE = new URL('./fixtures/spacy.json', import.meta.url);
const parses = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : {};

const facts = (g) => g.units.map((u) => `${u.rel}(${u.head ? g.text(g.get(u.head)) : ''})=${g.text(u)}`);

// What a correct conversion should produce for sentences spaCy parses right.
const EXPECT = {
  'The quick brown fox jumped over the lazy dog.': ['subj(jumped)=fox', 'prep(jumped)=over', 'pobj(over)=dog', 'mod(dog)=lazy'],
  'She gave her brother a book.': ['iobj(gave)=brother', 'dobj(gave)=book', 'mod(brother)=her'],
  "Don't touch the stove!": ['subj(Do touch)=you', 'mod(Do touch)=not', 'dobj(Do touch)=stove'],
  'Did you see the dog?': ['root()=Did see', 'subj(Did see)=you'],
  'The man who lives next door is a doctor.': ['relcl(man)=lives', 'subj(lives)=who', 'pred(is)=doctor'],
  'I know that he is right.': ['dobj(know)=is', 'mark(is)=that', 'pred(is)=right'],
  'I want to swim in the lake.': ['dobj(want)=swim', 'mark(swim)=to', 'prep(swim)=in'],
  'When the bell rang, the students left quickly.': ['advcl(left)=rang', 'mark(rang)=When'],
  'I like tea, but she likes coffee.': ['conj(like)=likes', 'cc(likes)=but'],
  'John and Mary washed the car and waxed the truck.': ['conj(John)=Mary', 'conj(washed)=waxed'],
  'There is a cat on the mat.': ['expl(is)=There', 'subj(is)=cat'],
  'My brother, a doctor, lives in New York.': ['appos(brother)=doctor', 'pobj(in)=New York'],
  "John's dog has been running all day.": ['root()=has been running', "mod(dog)=John's"],
  'They elected him president.': ['dobj(elected)=him'],
  'She looks happy.': ['pred(looks)=happy'],
  'The children laughed, sang, and danced.': ['conj(laughed)=sang', 'conj(laughed)=danced', 'cc(danced)=and'],
  'The house in which I live is old.': ['relcl(house)=live', 'pobj(in)=which'],
  'When asked about the plan, the senators were silent.': ['advcl(were)=(were) asked', 'subj((were) asked)=senators'],
};

EXPECT['Judgment in Cases of Impeachment shall not extend further than to removal from Office, and disqualification to hold and enjoy any Office of honor, Trust or Profit under the United States: but the Party convicted shall nevertheless be liable and subject to Indictment, Trial, Judgment and Punishment, according to Law.'] = ['conj(hold)=enjoy', 'dobj(enjoy)=Office', 'conj(liable)=subject', 'conj(removal)=disqualification'];

// the passage the reduced-clause and compound-sentence fixes came from
const CONSTITUTION = 'The Senate shall have the sole Power to try all Impeachments. When sitting for that Purpose, they shall be on Oath or Affirmation. When the President of the United States is tried, the Chief Justice shall preside: And no Person shall be convicted without the Concurrence of two thirds of the Members present.';
EXPECT[CONSTITUTION] = [
  'subj((are) sitting)=they', 'mark((are) sitting)=When', 'conj(shall preside)=shall be convicted', 'cc(shall be convicted)=And',
  'advcl(shall preside)=is tried', 'mod(Members)=present',
];

// Article I, Section 10: spaCy tags "except" as a conjunction, though it heads a
// phrase whose object is a whole clause; that clause was drawn twice
EXPECT["No State shall, without the Consent of the Congress, lay any Imposts or Duties on Imports or Exports, except what may be absolutely necessary for executing it's inspection Laws: and the net Produce of all Duties and Imposts, laid by any State on Imports or Exports, shall be for the Use of the Treasury of the United States; and all such Laws shall be subject to the Revision and Controul of the Congress."] = [
  'prep(shall lay)=except', 'pobj(except)=may be', 'subj(may be)=what', 'pobj(for)=executing', 'dobj(executing)=Laws', 'pobj(of)=Congress',
];

// Article II, Section 2: three clauses. "shall appoint" belongs to "he shall
// nominate", not to the first clause; joined clauses with their own subjects
// were drawn twice (as clauses and as parts of a verb fork), and a list with
// two "and"s left one floating
EXPECT['He shall have Power, by and with the Advice and Consent of the Senate, to make Treaties, provided two thirds of the Senators present concur; and he shall nominate, and by and with the Advice and Consent of the Senate, shall appoint Ambassadors, other public Ministers and Consuls, Judges of the supreme Court, and all other Officers of the United States, whose Appointments are not herein otherwise provided for, and which shall be established by Law: but the Congress may by Law vest the Appointment of such inferior Officers, as they think proper, in the President alone, in the Courts of Law, or in the Heads of Departments.'] = [
  'conj(shall have)=shall nominate', 'conj(shall nominate)=shall appoint', 'conj(shall have)=may vest',
  'cc(shall nominate)=and', 'cc(shall appoint)=and', 'cc(may vest)=but', 'cc(Consuls)=and', 'cc(Officers)=and',
];

test('fixtures are present (run scripts/capture-spacy.mjs with the server up)', () => {
  assert.ok(Object.keys(parses).length > 0, 'tests/fixtures/spacy.json is missing');
});

for (const [text, data] of Object.entries(parses)) {
  test(`spacy: ${text.slice(0, 70)}`, () => {
    const { tokens, units } = fromSpacy(text, data);
    const g = new Graph(tokens, units);
    // every non-punctuation token lands in exactly one unit
    const seen = new Map();
    for (const u of units) for (const i of u.tokens) seen.set(i, (seen.get(i) || 0) + 1);
    tokens.forEach((t) => assert.equal(seen.get(t.i), 1, `token “${t.text}” is in one unit`));
    // spans point back into the text
    for (const t of tokens) assert.ok(t.end <= text.length && t.start <= t.end, `span of “${t.text}”`);
    // a tree: one root per sentence, no cycles
    for (const u of units) {
      let n = 0;
      for (let c = u; c; c = g.head(c)) assert.ok(++n < 100, 'no cycles');
    }
    // the diagram draws every unit
    const { prims } = layoutGraph(g, measure);
    const drawn = new Set(prims.filter((p) => p.t === 'text').map((p) => p.uid));
    for (const u of units) assert.ok(drawn.has(u.id), `“${g.text(u)}” is drawn`);
    // ...and drawn in place, not left floating because nothing knew where it went
    assert.ok(!prims.some((p) => p.kind === 'loose'), 'no word is left loose');
    assertLegible(prims);
    if (EXPECT[text]) {
      const got = facts(g);
      for (const f of EXPECT[text]) assert.ok(got.includes(f), `missing ${f}\n  got: ${got.join(', ')}`);
    }
  });
}
