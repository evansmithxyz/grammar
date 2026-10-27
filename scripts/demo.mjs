// Records a demo video of Sentence Diagrammer: a scripted walk through its
// features in a real (headless) Chrome, with captions and a visible cursor.
//
//   node scripts/demo.mjs                            # records the live site into demo/
//   DEMO_URL=http://localhost:5173 node scripts/demo.mjs
//
// Needs Chrome (CHROME=path/to/chrome to point elsewhere) and ffmpeg on PATH.
// Writes demo/raw.webm, then demo/sentence-diagrammer-demo.mp4.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const URL = process.env.DEMO_URL || 'https://evansmith.xyz/diagrammer/';
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = 'demo';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ARTICLE_II = 'He shall have Power, by and with the Advice and Consent of the Senate, to make Treaties, provided two thirds of the Senators present concur; and he shall nominate, and by and with the Advice and Consent of the Senate, shall appoint Ambassadors, other public Ministers and Consuls, Judges of the supreme Court, and all other Officers of the United States, whose Appointments are not herein otherwise provided for, and which shall be established by Law: but the Congress may by Law vest the Appointment of such inferior Officers, as they think proper, in the President alone, in the Courts of Law, or in the Heads of Departments.';

// Captions, title cards, a cursor and a few lookups, added to the page.
function overlay() {
  const css = `
    #demo-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; width: 26px; height: 26px; margin: -3px 0 0 -4px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
    #demo-ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 3px solid #ffd23f; opacity: 0; }
    #demo-ring.on { animation: demo-ring .45s ease-out; }
    @keyframes demo-ring { from { opacity: .9; transform: scale(.4); } to { opacity: 0; transform: scale(1.4); } }
    #demo-cap { position: fixed; left: 50%; z-index: 2147483645; pointer-events: none; max-width: 78vw; padding: 11px 22px 13px; border-radius: 14px;
      background: rgba(13, 15, 21, .9); color: #f4f5f8; border: 1px solid rgba(255,255,255,.16); box-shadow: 0 18px 40px -14px rgba(0,0,0,.65);
      font: 700 21px/1.25 'Atkinson Hyperlegible', system-ui, sans-serif; text-align: center; opacity: 0; transform: translate(-50%, 10px); transition: opacity .35s, transform .35s; }
    #demo-cap.on { opacity: 1; transform: translate(-50%, 0); }
    #demo-cap small { display: block; margin-top: 3px; font-weight: 400; font-size: 15.5px; color: #c8cdd8; }
    #demo-cap.bottom { bottom: 22px; } #demo-cap.top { top: 18px; }
    #demo-card { position: fixed; inset: 0; z-index: 2147483644; display: grid; place-content: center; gap: 14px; text-align: center; pointer-events: none;
      background: radial-gradient(ellipse at 50% 40%, #243128, #12151b 70%); color: #eef2e6; opacity: 0; transition: opacity .6s; }
    #demo-card.on { opacity: 1; }
    #demo-card h1 { margin: 0; font: 400 76px/1 'Patrick Hand', cursive; }
    #demo-card p { margin: 0; font: 400 24px/1.4 'Atkinson Hyperlegible', sans-serif; color: #c8cdd8; }
    #demo-card svg { width: 72px; height: 72px; margin: 0 auto; fill: none; stroke: #eef2e6; stroke-width: 2.6; stroke-linecap: round; }
  `;
  const add = () => {
    if (document.getElementById('demo-cursor')) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    document.body.insertAdjacentHTML('beforeend', `
      <svg id="demo-cursor" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.6 14.8 L11.6 21.4 L14.6 20 L11.7 13.6 L18 13.4 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>
      <div id="demo-ring"></div><div id="demo-cap" class="bottom"></div>
      <div id="demo-card"><svg viewBox="0 0 32 32"><path d="M3 15h26M12 7v14M18 15l5 9"/></svg><h1></h1><p></p></div>`);
    const cursor = document.getElementById('demo-cursor'), ring = document.getElementById('demo-ring');
    addEventListener('mousemove', (e) => { cursor.style.left = `${e.clientX}px`; cursor.style.top = `${e.clientY}px`; }, true);
    addEventListener('mousedown', (e) => {
      ring.style.left = `${e.clientX}px`; ring.style.top = `${e.clientY}px`;
      ring.classList.remove('on'); void ring.offsetWidth; ring.classList.add('on');
    }, true);
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  // the middle of an element, once it's on screen: one that isn't is scrolled
  // into view first (null until it gets there, so the caller asks again)
  const mid = (el) => {
    const r = el.getBoundingClientRect();
    if (r.top < 4 || r.bottom > innerHeight - 4 || r.left < 0 || r.right > innerWidth) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      return null;
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  window.__demo = {
    add,
    caption(title, sub, where) {
      const c = document.getElementById('demo-cap');
      c.className = where || 'bottom';
      c.innerHTML = title ? `${title}${sub ? `<small>${sub}</small>` : ''}` : '';
      void c.offsetWidth;
      if (title) c.classList.add('on');
    },
    card(title, sub) {
      const k = document.getElementById('demo-card');
      k.querySelector('h1').textContent = title;
      k.querySelector('p').textContent = sub;
      k.classList.toggle('on', !!title);
      document.getElementById('demo-cursor').style.visibility = title ? 'hidden' : 'visible';
    },
    // the middle of the first visible element matching sel (and, if given, with exactly this text)
    at(sel, text) {
      const el = [...document.querySelectorAll(sel)].find((e) => visible(e) && (text == null || e.textContent.trim() === text));
      return el ? mid(el) : null;
    },
    // a word on the diagram: the middle of its hit area
    word(text) {
      const w = [...document.querySelectorAll('#diagram .wg[data-uid]')].find((e) => e.textContent === text);
      const h = w && document.querySelector(`#diagram .hit[data-uid="${w.dataset.uid}"]`);
      return h ? mid(h) : null;
    },
    // a practice slot, by the word that belongs in it
    slot(text) {
      const s = [...document.querySelectorAll('#diagram .slot')].find((e) => !e.classList.contains('filled')
        && document.querySelector(`#diagram .wg[data-uid="${e.dataset.slot}"]`)?.textContent === text);
      return s ? mid(s) : null;
    },
    // an empty spot on the board, away from words, for panning
    empty() {
      const st = document.getElementById('stage').getBoundingClientRect();
      for (let y = st.top + st.height * 0.55; y < st.bottom - 30; y += 17) {
        for (let x = st.left + st.width * 0.55; x < st.right - 30; x += 23) {
          const el = document.elementFromPoint(x, y);
          if (el && document.getElementById('stage').contains(el) && !el.closest('.hit, .zone, .slot')) return { x, y };
        }
      }
      return { x: st.left + 40, y: st.bottom - 40 };
    },
    // scroll so `sel`'s top sits `top` px below the top of the window
    scroll(sel, top = 8) {
      const r = document.querySelector(sel).getBoundingClientRect();
      scrollTo({ top: scrollY + r.top - top, behavior: 'smooth' });
    },
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
}

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1.5 },
  args: ['--window-size=1280,720', '--force-device-scale-factor=1.5', '--hide-scrollbars', '--force-color-profile=srgb'],
});
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }]);
await page.evaluateOnNewDocument(overlay);
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.querySelector('#parser-status')?.textContent.includes('en_core') && document.querySelectorAll('#diagram .wg').length > 3, { timeout: 30000 });

const demo = (fn, ...args) => page.evaluate((f, a) => window.__demo[f](...a), fn, args);
const caption = (title, sub, where) => demo('caption', title, sub, where);
const card = (title, sub) => demo('card', title, sub);
const scroll = async (sel, top) => { await demo('scroll', sel, top); await sleep(700); };
// where something is on screen, once it's there and has stopped moving (a
// smooth scroll that brought it into view may still be under way)
async function find(fn, ...args) {
  let last = null;
  for (let k = 0; k < 80; k++) {
    const p = await demo(fn, ...args);
    if (p && last && Math.abs(p.x - last.x) < 1 && Math.abs(p.y - last.y) < 1) return p;
    last = p;
    await sleep(p ? 90 : 120);
  }
  throw new Error(`demo: can't find ${fn}(${args.join(', ')})`);
}

// a pointer that glides rather than jumps
let mouse = { x: 1100, y: 640 };
async function moveTo(p, ms = 480) {
  const from = { ...mouse };
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (p.x - from.x) * e, from.y + (p.y - from.y) * e);
    await sleep(ms / steps);
  }
  mouse = { ...p };
}
async function click(p, after = 350) {
  await moveTo(p);
  await sleep(140);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  await sleep(after);
}
async function drag(a, b, after = 500) {
  await moveTo(a, 420);
  await sleep(160);
  await page.mouse.down();
  await sleep(120);
  await moveTo(b, 750);
  await sleep(160);
  await page.mouse.up();
  await sleep(after);
}
async function typeSentence(text, delay = 42) {
  await click(await find('at', '#sentence'), 150);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.type(text, { delay });
  await sleep(300);
  await page.keyboard.press('Enter');
}
const menu = async (label) => click(await find('at', '#role-menu button', label), 700);

await page.mouse.move(mouse.x, mouse.y);
await card('Sentence Diagrammer', 'Reed–Kellogg sentence diagrams, drawn as you type');
await sleep(800);
const rec = await page.screencast({ path: `${OUT}/raw.webm`, quality: 18 });
await sleep(3200);
await card('', '');
await sleep(700);

// 1. type a sentence
await caption('Type a sentence', 'It’s parsed and diagrammed as you type');
await typeSentence('The girl with the red hat sang a song to her mother.');
await sleep(800);
await caption('Press Enter to watch it drawn', 'Lines go down like pen strokes; words fly into place');
await sleep(4200);

// 2. the marked-up sentence
await caption('The sentence is marked up too', 'Subject underlined once, verb twice, object circled, phrases in parentheses');
for (const w of ['girl', 'sang', 'song', 'mother']) {
  await moveTo(await find('at', '#strip .tok', w), 420);
  await sleep(650);
}
await sleep(900);

// 3. boards
await caption('Three boards', 'Chalkboard, notebook paper or textbook print', 'bottom');
for (const b of ['Notebook', 'Textbook', 'Chalk']) {
  await click(await find('at', '#theme-seg button', b), 1900);
}

// 4. fix the parse
await caption('Read it differently? Show your reading', '“I saw the man with the telescope” can be read two ways');
await typeSentence('I saw the man with the telescope.', 26);
await sleep(3300);
await click(await find('word', 'with'), 900);
const onSaw = await page.$eval('#inspector', (e) => e.textContent.includes('modifies “saw”'));
await caption('Click a word to see its job', 'The Word panel says what it does, in plain English', 'top');
await sleep(2400);
await caption('Drag it to change where it hangs', onSaw ? 'Now “with the telescope” describes the man' : 'Now “with the telescope” tells how I saw', 'top');
await drag(await find('word', 'with'), await find('word', onSaw ? 'man' : 'saw'), 2600);

// 5. arcs
await caption('Or see the same parse as a dependency graph', '', 'top');
await click(await find('at', '#view-seg button', 'Arcs'), 2600);
await click(await find('at', '#view-seg button', 'Diagram'), 900);

// 6. a long sentence: zoom and pan
await caption('Long sentences too', 'Article II, Section 2 of the Constitution, parsed by spaCy’s transformer model');
await click(await find('at', '#sentence'), 150);
// set the text without an input event: Enter alone waits for spaCy's parse,
// instead of flashing the quick in-browser one first
await page.$eval('#sentence', (el, t) => { el.value = t; }, ARTICLE_II);
await sleep(400);
await page.keyboard.press('Enter');
await sleep(1200);
await scroll('.board-panel', 6);
await sleep(4500);
await caption('Zoom in, then drag the board to look around', '', 'top');
for (let k = 0; k < 3; k++) await click(await find('at', '#zoom-in'), 300);
await sleep(500);
let spot = await demo('empty');
await drag(spot, { x: spot.x - 360, y: spot.y - 170 }, 700);
spot = await demo('empty');
await drag(spot, { x: spot.x + 260, y: spot.y - 140 }, 1200);
await click(await find('at', '#zoom-fit'), 900);

// 7. guided
await scroll('main', 0);
await caption('Guided mode: one question at a time', 'Find the verb, then the subject, then what completes it…', 'top');
await click(await find('at', '#mode-seg button', 'Guided'), 600);
await page.select('#level', 'dobj');
await sleep(2400);
await scroll('.board-panel', 6);
await caption('Wrong answers are explained', 'from what the word really does in the sentence', 'top');
await click(await find('at', '#guide-words .chip', 'dog'), 2900);
await caption('', '');
await click(await find('at', '#guide-words .chip', 'chased'), 1700);
await click(await find('at', '#guide-words .chip', 'dog'), 1600);
await click(await find('at', '#guide-words .chip', 'cat'), 1800);
await click(await find('at', '#guide-words .chip', 'dog'), 1300);
await click(await find('at', '#guide-words .chip', 'cat'), 1000);
await caption('Thirteen levels', 'From subjects and verbs to noun clauses; each dot fills in as you finish a sentence', 'top');
await sleep(2600);

// 8. practice
await caption('Practice: the lines are drawn, the words are missing', 'Drag each word into its slot, then check', 'top');
await click(await find('at', '#mode-seg button', 'Practice'), 1200);
await scroll('#practice-bar', 330);
for (const w of ['dog', 'chased', 'cat', 'The', 'the']) {
  await drag(await find('at', '#tray .tile', w), await find('slot', w), 300);
}
await click(await find('at', '#pr-check'), 2400);

// 9. from scratch
await caption('From scratch: build the whole diagram', 'Start with the verb, then hang every word where it belongs', 'top');
await click(await find('at', '#mode-seg button', 'From scratch'), 600);
await page.select('#level', 'sentences');
await sleep(1500);
await click(await find('at', '#level-dots .dot[data-i="3"]'), 2400);
await scroll('.board-panel', 6);
await drag(await find('at', '#scratch-tray .tile', 'sang'), await find('at', '#dropzone'), 700);
await drag(await find('at', '#scratch-tray .tile', 'She'), await find('at', '#diagram .zone'), 700);
await caption('Joining clauses: the conjunction first', 'Drop “and” on the first verb, then the next verb on “and”', 'top');
await drag(await find('at', '#scratch-tray .tile', 'and'), await find('word', 'sang'), 400);
await menu('Conjunction');
await drag(await find('at', '#scratch-tray .tile', 'played'), await find('word', 'and'), 900);
await drag(await find('at', '#scratch-tray .tile', 'he'), await find('word', 'played'), 400);
await menu('Subject');
await caption('', '');
await drag(await find('at', '#scratch-tray .tile', 'piano'), await find('word', 'played'), 400);
await menu('Direct object');
await drag(await find('at', '#scratch-tray .tile', 'the'), await find('word', 'piano'), 400);
await menu('Modifier');
await click(await find('at', '#sc-check'), 2800);

// 10. end
await caption('', '');
await card('Sentence Diagrammer', 'evansmith.xyz/diagrammer');
await sleep(3800);
await rec.stop();
await browser.close();

// the finished file: H.264 plays anywhere; fade in from black, start playing before it's all downloaded
const mp4 = `${OUT}/sentence-diagrammer-demo.mp4`;
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', `${OUT}/raw.webm`,
  '-vf', 'fade=t=in:st=0:d=0.6,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
console.log(`wrote ${mp4}`);
