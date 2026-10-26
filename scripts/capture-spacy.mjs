// Records the parse server's answers for a set of sentences in
// tests/fixtures/spacy.json, and for the level sentences in
// tests/fixtures/levels.json, so the tests run without the server.
// Start the server (npm run server), then: node scripts/capture-spacy.mjs
// (PARSER_URL=https://your.site/api records from a deployed server instead.)
import { mkdirSync, writeFileSync } from 'node:fs';
import { EXAMPLES } from '../src/examples.js';
import { LEVELS } from '../src/levels.js';

const URL = (process.env.PARSER_URL || 'http://localhost:8000').replace(/\/$/, '');
const EXTRA = [
  "John's dog has been running all day.",
  'There is a cat on the mat.',
  'If it rains tomorrow, we will stay inside and play games.',
  'I told her that he left.',
  'The house in which I live is old.',
  'Although the weather was terrible, the team that had trained all year drove for six hours and still won the championship because they never gave up.',
  'I saw the man with the telescope.',
  "I can't believe it's not butter.",
  'Mr. Smith teaches math at the high school.',
  'This is the first sentence. This is the second one!',
  'The Senate shall have the sole Power to try all Impeachments. When sitting for that Purpose, they shall be on Oath or Affirmation. When the President of the United States is tried, the Chief Justice shall preside: And no Person shall be convicted without the Concurrence of two thirds of the Members present.',
  'When asked about the plan, the senators were silent.',
  'Judgment in Cases of Impeachment shall not extend further than to removal from Office, and disqualification to hold and enjoy any Office of honor, Trust or Profit under the United States: but the Party convicted shall nevertheless be liable and subject to Indictment, Trial, Judgment and Punishment, according to Law.',
  "No State shall, without the Consent of the Congress, lay any Imposts or Duties on Imports or Exports, except what may be absolutely necessary for executing it's inspection Laws: and the net Produce of all Duties and Imposts, laid by any State on Imports or Exports, shall be for the Use of the Treasury of the United States; and all such Laws shall be subject to the Revision and Controul of the Congress.",
  'He shall have Power, by and with the Advice and Consent of the Senate, to make Treaties, provided two thirds of the Senators present concur; and he shall nominate, and by and with the Advice and Consent of the Senate, shall appoint Ambassadors, other public Ministers and Consuls, Judges of the supreme Court, and all other Officers of the United States, whose Appointments are not herein otherwise provided for, and which shall be established by Law: but the Congress may by Law vest the Appointment of such inferior Officers, as they think proper, in the President alone, in the Courts of Law, or in the Heads of Departments.',
  'John washed and waxed the car.',
  'He laughed and ate an apple.',
  'You may leave early, provided you finish your work.',
  'She walked up and down the street.',
  'The problem was dealt with quickly.',
  'We hire such workers as we need.',
];

async function capture(texts, file) {
  const out = {};
  for (const text of texts) {
    const r = await fetch(`${URL}/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error(`${r.status} for “${text}”`);
    const data = await r.json();
    out[text] = { model: data.model, tokens: data.tokens };
    console.log(`${String(data.ms).padStart(6)} ms  ${text}`);
  }
  mkdirSync('tests/fixtures', { recursive: true });
  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`saved ${Object.keys(out).length} parses to ${file}`);
}

await capture([...EXAMPLES.map((e) => e.text), ...EXTRA], 'tests/fixtures/spacy.json');
await capture(LEVELS.flatMap((l) => l.sentences), 'tests/fixtures/levels.json');
