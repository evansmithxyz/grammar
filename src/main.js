import './fonts.css';
import './styles.css';

import { parse } from './nlp/parser.js';
import { fromSpacy } from './nlp/spacy.js';
import { Graph, RELATIONS, guessRelation, encodeUnits, decodeUnits } from './model/graph.js';
import { blank, attachedIds, makeRoot, detachTree, jobChoices, grade } from './model/scratch.js';
import { Guide } from './model/guided.js';
import { reattach, setRelation, detach, mergeNext, split } from './model/edit.js';
import { layoutGraph } from './diagram/layout.js';
import { renderDiagram, animateDraw, makeMeasurer } from './diagram/render.js';
import { renderArcs } from './diagram/arcs.js';
import { THEMES } from './diagram/themes.js';
import { EXAMPLES, GROUPS, GROUP_LABELS } from './examples.js';
import { Strip } from './ui/strip.js';
import { Inspector } from './ui/inspector.js';
import { attachWordDrag } from './ui/drag.js';
import { Practice } from './ui/practice.js';
import { ScratchTray, chooseJob } from './ui/scratch.js';
import { GuideBar } from './ui/guided.js';
import { attachPan } from './ui/pan.js';
import { renderLegend } from './ui/legend.js';
import { svgBlob, pngBlob, downloadLink, fileName } from './ui/export.js';

const $ = (id) => document.getElementById(id);
const svg = $('diagram');
const input = $('sentence');

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// Inside the claude.ai viewer the page runs in a frame: hash links can't reach
// the viewer's address bar, and files are saved through the host.
const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();

/** The board that suits the viewer's light/dark setting. */
function hostBoard() {
  const t = document.documentElement.dataset.theme; // set by the claude.ai viewer, if any
  if (t === 'light') return 'notebook';
  if (t === 'dark') return 'chalk';
  return matchMedia('(prefers-color-scheme: light)').matches ? 'notebook' : 'chalk';
}

// The optional parse server (server/app.py). On your own machine it runs beside
// the dev server on port 8000; on a hosted site the web server passes /api to it
// (deploy/Caddyfile). Inside the claude.ai viewer the frame blocks requests to
// other hosts, so the page uses the built-in rules there.
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.protocol === 'file:';
const PARSER_URL = (import.meta.env.VITE_PARSER_URL || (LOCAL ? 'http://localhost:8000' : '/api')).replace(/\/$/, '');
const server = { state: 'checking', model: null, ms: null }; // checking | ready | off

const state = {
  text: '',
  source: 'rules', // which parser produced the current units
  parser: store.get('parser', 'server'), // what the user picked
  tokens: [],
  units: [],
  auto: [], // the parser's output, for "reset"
  history: [],
  future: [],
  selected: null,
  hover: null,
  view: 'rk',
  mode: 'explore',
  theme: store.get('theme', null) || hostBoard(),
  zoom: null,
  key: null, // build-from-scratch: the answer the learner's diagram is checked against
  grade: null, // build-from-scratch: Map of unit id → 'right' | 'wrong' | 'unplaced'
  guide: null, // guided mode: the learner's progress through the questions
  feedback: null, // guided mode: what the last answer earned
};
if (!THEMES[state.theme]) state.theme = 'chalk';
let measure = makeMeasurer(THEMES[state.theme]);

const graph = () => new Graph(state.tokens, state.units);

// ---------- rendering ----------

const strip = new Strip($('strip'), {
  onHover: (uid) => setHover(uid),
  onSelect: (uid, uids) => (state.mode === 'guided' ? guideAnswer(uids.length ? uids : [uid]) : select(uid)),
});

const inspector = new Inspector($('inspector'), {
  setRelation: (uid, rel) => edit((u) => setRelation(u, state.tokens, uid, rel)),
  reattach: (uid, head) => {
    const g = graph();
    edit((u) => reattach(u, state.tokens, uid, head, guessRelation(g, g.get(uid), g.get(head))));
  },
  detach: (uid) => edit((u) => (state.mode === 'scratch' ? detachTree(u, uid) : detach(u, uid))),
  merge: (uid) => edit((u) => mergeNext(u, state.tokens, uid), { keepSelection: true }),
  split: (uid) => edit((u) => split(u, state.tokens, uid), { keepSelection: true }),
  select: (uid) => select(uid),
});

const practice = new Practice({ tray: $('tray'), score: $('score') });
const scratchTray = new ScratchTray({ tray: $('scratch-tray'), board: $('board'), onDrop: (uid, at) => dropTile(uid, at) });
const guideBar = new GuideBar($('guide-bar'), {
  onAnswer: (choice) => guideAnswer(choice),
  onHint: () => guideStep((gd) => gd.hint()),
  onShow: () => guideStep((gd) => gd.show()),
  onRestart: () => { startGuided(); render(); },
  onNew: () => nextPractice(),
});

function clearDiagram() {
  svg.replaceChildren();
  svg.setAttribute('width', 0);
  svg.setAttribute('height', 0);
  svg.style.width = svg.style.height = '0px';
  svg.dataset.w = 0;
}

function render({ animate = false, flip = false } = {}) {
  const theme = THEMES[state.theme];
  const g = graph();
  if (state.selected && !g.get(state.selected)) state.selected = null;
  const scratch = state.mode === 'scratch';
  const gd = state.mode === 'guided' ? state.guide : null;
  // outside Explore the sentence stays unmarked, or it would give the answers
  // away; in Guided it's marked up as the learner finds each part
  if (gd) strip.render(state.text, new Graph(state.tokens, gd.units()), theme, { shown: gd.placed });
  else strip.render(state.text, state.tokens.length ? g : null, theme, { plain: state.mode !== 'explore' });
  $('board').classList.toggle('guided', !!gd);
  let slots = [];
  const placed = scratch ? attachedIds(state.units) : null;
  if (!state.units.length) {
    clearDiagram();
  } else if (gd) {
    // only what the learner has found so far
    const built = new Graph(state.tokens, gd.units().filter((u) => gd.placed.has(u.id)));
    if (built.units.length) renderDiagram(svg, layoutGraph(built, measure), built, theme);
    else clearDiagram();
    guideBar.render({ text: state.text, tokens: state.tokens, guide: gd, feedback: state.feedback });
  } else if (scratch) {
    // only what the learner has built so far; the rest waits in the tray
    const built = new Graph(state.tokens, state.units.filter((u) => placed.has(u.id)));
    if (built.units.length) renderDiagram(svg, layoutGraph(built, measure), built, theme, { zones: true });
    else clearDiagram();
    scratchTray.render(g, state.units.filter((u) => !placed.has(u.id)).sort((a, b) => g.order(a) - g.order(b)));
    if (state.grade) {
      for (const hit of svg.querySelectorAll('.hit[data-uid]')) {
        const mark = state.grade.get(hit.dataset.uid);
        if (mark) hit.classList.add(mark);
      }
    }
  } else if (state.view === 'arcs' && state.mode === 'explore') {
    renderArcs(svg, g, theme, measure);
  } else {
    const layout = layoutGraph(g, measure);
    ({ slots } = renderDiagram(svg, layout, g, theme, { practice: state.mode === 'practice' }));
  }
  applyZoom();
  if (state.mode === 'practice') practice.mount(svg, slots, state.text);
  paintSelection();
  inspector.phase = gd?.phaseIndex();
  inspector.render(g, state.selected, state.mode, placed);
  updateStatus(g);
  if (scratch) showScratchProgress(g, placed);
  if (gd) $('status').textContent = gd.done ? `${gd.steps.length} of ${gd.steps.length} steps` : `Step ${gd.i + 1} of ${gd.steps.length}`;
  $('dropzone').textContent = gd ? 'The diagram builds itself here as you answer.' : 'Drag the main verb here to start the baseline.';
  $('dropzone').hidden = gd ? !state.units.length || gd.placed.size > 0
    : !scratch || !state.units.length || [...placed].some((id) => g.get(id)?.rel === 'root');
  updateButtons();
  $('board-hint').textContent = !state.units.length ? ''
    : state.mode === 'practice' ? 'Drag each tile onto its slot, then check.'
    : scratch ? 'Drag words from the tray onto the board. Drag a word back to the tray to remove it.'
    : gd ? 'Answer by clicking a word.'
    : 'Drag a word onto another to re-attach it. Click a word to inspect it.';
  if (animate && state.units.length) {
    animateDraw(svg, { words: !flip });
    if (flip) flyIn();
  }
  saveHash();
}

function applyZoom() {
  const w = +svg.dataset.w || 0, h = +svg.dataset.h || 0;
  if (!w) return syncPan();
  const stage = $('stage');
  const avail = stage.clientWidth - 36;
  const fit = Math.min(1.7, avail / w);
  const scale = state.zoom ?? Math.max(fit, Math.min(0.62, avail / w * 1.6));
  svg.style.width = `${w * scale}px`;
  svg.style.height = `${h * scale}px`;
  syncPan();
}

// drag the empty board to move around a big diagram
const syncPan = attachPan($('stage'));

/** Words fly from the sentence strip into their places on the diagram. */
function flyIn() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctm = svg.getScreenCTM();
  if (!ctm) return;
  const k = ctm.a || 1;
  let n = 0;
  for (const wg of svg.querySelectorAll('.wg[data-uid]')) {
    const from = strip.rectOf(wg.dataset.uid);
    const to = wg.getBoundingClientRect();
    if (!from || !to.width) continue;
    const dx = (from.left + from.width / 2 - (to.left + to.width / 2)) / k;
    const dy = (from.top + from.height / 2 - (to.top + to.height / 2)) / k;
    wg.animate(
      [{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0.2 }, { transform: 'translate(0, 0)', opacity: 1 }],
      { duration: 760, delay: 80 + n++ * 28, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'backwards' },
    );
  }
}

function paintSelection() {
  for (const n of svg.querySelectorAll('.wg.selected, .wg.hover')) n.classList.remove('selected', 'hover');
  if (state.selected) for (const n of svg.querySelectorAll(`.wg[data-uid="${state.selected}"]`)) n.classList.add('selected');
  if (state.hover) for (const n of svg.querySelectorAll(`.wg[data-uid="${state.hover}"]`)) n.classList.add('hover');
  strip.highlight(state.selected, 'selected');
  strip.highlight(state.hover, 'hover');
}

function setHover(uid) {
  if (state.hover === uid) return;
  state.hover = uid;
  paintSelection();
}

function select(uid) {
  state.selected = uid || null;
  paintSelection();
  if (uid) showTab('word');
  inspector.render(graph(), state.selected, state.mode);
}

/** "9 words · 1 phrase · 1 clause" under the board. */
function updateStatus(g) {
  const words = state.tokens.length;
  const phrases = g.units.filter((u) => u.rel === 'prep' || (u.pos === 'VERB' && !g.kid(u, 'subj') && u.rel !== 'root' && u.rel !== 'conj')).length;
  const clauses = g.units.filter((u) => u.pos === 'VERB' && g.kid(u, 'subj')).length;
  const loose = g.units.filter((u) => u.rel === 'float').length;
  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
  const parts = words ? [n(words, 'word'), n(phrases, 'phrase'), n(clauses, 'clause')] : ['No sentence yet'];
  if (loose) parts.push(`${loose} unattached`);
  $('status').textContent = parts.join(' · ');
}

function updateButtons() {
  $('undo').disabled = !state.history.length;
  $('redo').disabled = !state.future.length;
  $('reset').disabled = state.mode !== 'explore' || JSON.stringify(encodeUnits(state.units)) === JSON.stringify(encodeUnits(state.auto));
}

// ---------- state changes ----------

const useServer = () => !framed && state.parser === 'server' && server.state === 'ready';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let parseSeq = 0;
let inflight = null;

/**
 * Parse and show a sentence. With the server on, typing shows the instant
 * in-browser parse and swaps in the server's when it arrives; an animated load
 * (Enter, an example) waits briefly so it draws once, with the server's parse.
 */
function setText(text, { animate = true, fromHash = null } = {}) {
  const seq = ++parseSeq;
  inflight?.abort();
  inflight = null;
  state.text = text;
  const local = () => (text.trim() ? parse(text) : { tokens: [], units: [] });
  const show = (res, source, anim) => {
    apply(res, source, fromHash);
    render({ animate: anim, flip: anim });
  };
  if (!text.trim() || !useServer()) return show(local(), 'rules', animate);

  const ctrl = new AbortController();
  inflight = ctrl;
  const remote = serverParse(text, ctrl.signal);
  const fail = (err) => {
    if (err?.name !== 'AbortError' && seq === parseSeq) {
      server.state = 'off';
      showParser();
    }
    return null;
  };
  // replace the quick parse, unless the user has typed on or started editing
  const swapIn = (res) => {
    if (!res || seq !== parseSeq || state.history.length) return;
    apply(res, 'server', fromHash);
    render();
  };
  if (animate) {
    Promise.race([remote.catch(fail), wait(3000).then(() => 'slow')]).then((res) => {
      if (seq !== parseSeq) return;
      if (res && res !== 'slow') return show(res, 'server', true);
      show(local(), 'rules', true);
      if (res === 'slow') remote.then(swapIn, fail);
    });
  } else {
    show(local(), 'rules', false);
    remote.then(swapIn, fail);
  }
}

function apply(res, source, fromHash) {
  state.tokens = res.tokens;
  state.auto = res.units;
  state.units = res.units;
  state.source = source;
  // a shared link's edits only fit the parser they were made on
  if (fromHash?.g && (fromHash.p || 'rules') === source) {
    try {
      const restored = decodeUnits(fromHash.g, res.tokens);
      if (restored.every((u) => u.tokens.every((i) => i < res.tokens.length))) state.units = restored;
    } catch { /* bad link: keep the automatic parse */ }
  }
  state.history = [];
  state.future = [];
  state.selected = null;
  practice.reset();
  if (state.mode === 'scratch') startScratch();
  if (state.mode === 'guided') startGuided();
  showParser();
}

async function serverParse(text, signal) {
  const r = await fetch(`${PARSER_URL}/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!r.ok) throw new Error(`The parse server answered ${r.status}.`);
  const data = await r.json();
  server.ms = data.ms;
  server.model = data.model;
  return fromSpacy(text, data);
}

async function checkServer() {
  if (framed) { server.state = 'off'; return false; }
  server.state = 'checking';
  showParser();
  try {
    const r = await fetch(`${PARSER_URL}/health`, { signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    server.state = j.ok ? 'ready' : 'off';
    server.model = j.model;
  } catch {
    server.state = 'off';
  }
  showParser();
  return server.state === 'ready';
}

/** The Parser menu's status dot and the note under the sentence box. */
function showParser() {
  const status = $('parser-status');
  const note = $('parser-note');
  const host = /^https?:/.test(PARSER_URL) ? PARSER_URL.replace(/^https?:\/\//, '') : location.host + PARSER_URL;
  const rulesNote = 'Parsed in your browser by a set of grammar rules. When it gets a word wrong, drag the word where it belongs.';
  status.className = 'parser-status';
  status.title = '';
  if (framed || state.parser === 'rules') {
    status.textContent = '';
    note.textContent = rulesNote;
    return;
  }
  if (server.state === 'checking') {
    status.textContent = `Connecting to ${host}…`;
  } else if (server.state === 'ready') {
    status.classList.add('ok');
    const m = server.model ? `${server.model.name} ${server.model.version}` : 'spaCy';
    status.textContent = state.source === 'server' && server.ms != null ? `${m} · ${Math.round(server.ms)} ms` : m;
    note.textContent = 'Parsed by spaCy on your parse server. When it gets a word wrong, drag the word where it belongs.';
    return;
  } else {
    status.classList.add('off');
    status.textContent = `Not running at ${host}. Using the built-in rules.`;
    status.title = LOCAL ? 'Start it with: npm run server' : '';
  }
  note.textContent = rulesNote;
}

function edit(fn, { keepSelection = false } = {}) {
  const { units, error } = fn(state.units);
  if (error) return toast(error);
  if (units === state.units) return;
  state.history.push(state.units);
  if (state.history.length > 100) state.history.shift();
  state.future = [];
  const prevSel = state.selected;
  state.units = units;
  state.grade = null;
  if (!keepSelection && prevSel && !units.find((u) => u.id === prevSel)) state.selected = null;
  render();
  pulse(state.selected);
}

function pulse(uid) {
  if (!uid) return;
  for (const n of svg.querySelectorAll(`.wg[data-uid="${uid}"]`)) {
    n.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' });
  }
}

function undo() {
  if (!state.history.length) return;
  state.future.push(state.units);
  state.units = state.history.pop();
  render();
}
function redo() {
  if (!state.future.length) return;
  state.history.push(state.units);
  state.units = state.future.pop();
  render();
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- URL ----------

const b64 = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))),
};
let hashTimer;
function saveHash() {
  if (framed) return;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const p = new URLSearchParams();
    if (state.text) p.set('s', state.text);
    const edited = state.mode === 'explore' && JSON.stringify(encodeUnits(state.units)) !== JSON.stringify(encodeUnits(state.auto));
    if (edited) {
      p.set('g', b64.enc(JSON.stringify(encodeUnits(state.units))));
      if (state.source !== 'rules') p.set('p', state.source);
    }
    try { history.replaceState(null, '', `#${p.toString()}`); } catch { /* no URL to update */ }
  }, 250);
}
function readHash() {
  if (framed) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  const s = p.get('s');
  if (!s) return null;
  let g = null;
  try { if (p.get('g')) g = JSON.parse(b64.dec(p.get('g'))); } catch { g = null; }
  return { s, g, p: p.get('p') };
}

// ---------- wiring ----------

attachWordDrag(svg, {
  label: (uid) => graph().text(graph().get(uid)) || '…',
  canDrop: (uid, el) => {
    if (state.mode === 'practice' || state.mode === 'guided') return false;
    if (el.classList.contains('zone')) return state.mode === 'scratch';
    const g = graph();
    const t = g.get(el.dataset.uid);
    return !!t && !g.dominates(g.get(uid), t);
  },
  // in scratch mode, a word dragged off the board goes back to the tray
  onDropElsewhere: (uid, x, y) => {
    if (state.mode !== 'scratch' || !document.elementsFromPoint(x, y).includes($('scratch-bar'))) return false;
    edit((u) => detachTree(u, uid));
    return true;
  },
  onHover: (uid) => setHover(uid),
  onClick: (uid) => (state.mode === 'guided' ? guideAnswer([uid]) : select(state.selected === uid ? null : uid)),
  onDragStart: (uid) => {
    if (state.mode === 'guided') return;
    const g = graph();
    for (const n of svg.querySelectorAll('.wg[data-uid]')) {
      const u = g.get(n.dataset.uid);
      if (u && g.dominates(g.get(uid), u)) n.classList.add('dimmed');
    }
  },
  onDragEnd: () => render(),
  onDrop: async (uid, el, x, y) => {
    const g = graph();
    if (el.classList.contains('zone')) return dropOnZone(uid, el);
    const target = el.dataset.uid;
    if (state.mode === 'scratch') {
      // the learner says what job the word does
      render();
      return placeWord(uid, target, x, y);
    }
    const rel = guessRelation(g, g.get(uid), g.get(target));
    state.selected = uid;
    edit((u) => reattach(u, state.tokens, uid, target, rel), { keepSelection: true });
  },
});

let typeTimer;
input.addEventListener('input', () => {
  clearTimeout(typeTimer);
  typeTimer = setTimeout(() => setText(input.value, { animate: false }), 220);
});
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearTimeout(typeTimer);
  // pick the server up if it was started after the page loaded
  if (state.parser === 'server' && server.state === 'off') await checkServer();
  setText(input.value, { animate: true });
});

$('parser').addEventListener('change', async (e) => {
  state.parser = e.target.value;
  store.set('parser', state.parser);
  if (state.parser === 'server') await checkServer();
  showParser();
  setText(state.text, { animate: true });
});

function loadSentence(text) {
  input.value = text;
  setText(text, { animate: true });
  $('strip').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderExamples() {
  const sel = $('examples');
  const first = document.createElement('option');
  first.value = '';
  first.textContent = 'Load an example…';
  sel.append(first);
  for (const grp of GROUPS) {
    const og = document.createElement('optgroup');
    og.label = GROUP_LABELS[grp] || grp;
    for (const ex of EXAMPLES.filter((e) => e.group === grp)) {
      const o = document.createElement('option');
      o.value = ex.text;
      o.textContent = ex.text;
      og.append(o);
    }
    sel.append(og);
  }
  sel.addEventListener('change', () => {
    if (sel.value) loadSentence(sel.value);
    sel.value = '';
  });
}

function showTab(name) {
  const word = name === 'word';
  $('tab-word').setAttribute('aria-selected', String(word));
  $('tab-key').setAttribute('aria-selected', String(!word));
  $('inspector').hidden = !word;
  $('key').hidden = word;
}
$('tab-word').addEventListener('click', () => showTab('word'));
$('tab-key').addEventListener('click', () => showTab('key'));

function setSeg(id, attr, value) {
  for (const b of $(id).querySelectorAll('button')) {
    const on = b.dataset[attr] === value;
    b.setAttribute(b.getAttribute('role') === 'radio' ? 'aria-checked' : 'aria-selected', String(on));
  }
}

$('view-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.view = b.dataset.view;
  state.zoom = null;
  setSeg('view-seg', 'view', state.view);
  render({ animate: true });
});

$('mode-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.mode === state.mode) return;
  if (state.mode === 'scratch') leaveScratch();
  state.guide = null;
  state.feedback = null;
  state.mode = b.dataset.mode;
  setSeg('mode-seg', 'mode', state.mode);
  $('practice-bar').hidden = state.mode !== 'practice';
  $('scratch-bar').hidden = state.mode !== 'scratch';
  $('guide-bar').hidden = state.mode !== 'guided';
  state.selected = null;
  if (state.mode === 'guided') {
    state.view = 'rk';
    setSeg('view-seg', 'view', 'rk');
    if (!state.text) nextPractice();
    else { startGuided(); render(); }
  } else if (state.mode === 'scratch') {
    state.view = 'rk';
    setSeg('view-seg', 'view', 'rk');
    if (!state.text) nextPractice();
    else { startScratch(); render({ animate: true }); }
  } else if (state.mode === 'practice') {
    state.view = 'rk';
    setSeg('view-seg', 'view', 'rk');
    if (!state.text) nextPractice();
    else { practice.reset(); render({ animate: true }); }
  } else render({ animate: true });
});

// ---------- build from scratch ----------

/** The current parse becomes the answer key; every word goes to the tray. */
function startScratch() {
  state.key = state.units;
  state.units = blank(state.key);
  state.history = [];
  state.future = [];
  state.grade = null;
  state.selected = null;
}

function leaveScratch() {
  if (state.key) state.units = state.key;
  state.key = null;
  state.grade = null;
  state.history = [];
  state.future = [];
  $('dropzone').hidden = true;
}

/** A word dropped from the tray: onto the board starts the baseline, onto a word attaches to it. */
async function dropTile(uid, { target, onBoard, x, y }) {
  if (target?.classList.contains('zone')) return dropOnZone(uid, target);
  if (target) return placeWord(uid, target.dataset.uid, x, y);
  if (!onBoard) return;
  const hasRoot = state.units.some((u) => u.rel === 'root' && u.head == null && u.sent === graph().get(uid)?.sent);
  if (hasRoot) return toast('Drop it onto the word it belongs to.');
  state.selected = null;
  edit((u) => makeRoot(u, uid));
}

/** A word dropped into an empty subject slot becomes that verb's subject. */
function dropOnZone(uid, zone) {
  if (zone.dataset.zone === 'subj') edit((u) => reattach(u, state.tokens, uid, zone.dataset.verb, 'subj'));
}

async function placeWord(uid, headId, x, y) {
  const g = graph();
  const u = g.get(uid), h = g.get(headId);
  if (!u || !h || u.id === h.id) return;
  const keyRel = state.key?.find((k) => k.id === uid)?.rel;
  const labels = Object.fromEntries(Object.entries(RELATIONS).map(([k, v]) => [k, v.label]));
  const rel = await chooseJob($('role-menu'), {
    x, y, word: g.text(u), head: g.text(h), labels,
    choices: jobChoices(state.units, state.tokens, uid, headId, keyRel),
  });
  if (!rel) return render();
  edit((units) => reattach(units, state.tokens, uid, headId, rel));
}

function showScratchProgress(g, placed) {
  const total = g.units.length;
  const done = [...placed].length;
  $('status').textContent = `${done} of ${total} words placed`;
  if (!state.grade) {
    $('scratch-score').textContent = done ? `${done} of ${total} words placed` : 'Start with the main verb';
    return;
  }
  const v = [...state.grade.values()];
  const right = v.filter((x) => x === 'right').length;
  const unplaced = v.filter((x) => x === 'unplaced').length;
  $('scratch-score').textContent = right === total ? `All ${total} right. Nicely built.`
    : `${right} of ${total} right${unplaced ? ` · ${unplaced} still in the tray` : ''}`;
}

$('sc-check').addEventListener('click', () => {
  if (!state.key) return;
  state.grade = grade(state.units, state.key, state.tokens);
  render();
});
$('sc-answer').addEventListener('click', () => {
  if (!state.key) return;
  edit(() => ({ units: state.key.map((u) => ({ ...u })) }));
  state.grade = grade(state.units, state.key, state.tokens);
  render({ animate: true });
});
$('sc-reset').addEventListener('click', () => state.key && edit(() => ({ units: blank(state.key) })));
$('sc-new').addEventListener('click', () => nextPractice());

// ---------- guided ----------

/** The current parse becomes the answer key; the board starts empty. */
function startGuided() {
  state.guide = state.units.length ? new Guide(state.tokens, state.units) : null;
  state.feedback = null;
  state.history = [];
  state.future = [];
  state.selected = null;
}

/** Run one guided action (an answer, a hint, Show me), then redraw what it added. */
function guideStep(fn) {
  const gd = state.guide;
  if (!gd || gd.done) return;
  const before = new Set(gd.placed);
  const fb = fn(gd);
  if (!fb) return;
  state.feedback = fb;
  render();
  guideBar.flash(fb.ids, fb.type);
  const added = new Set([...gd.placed].filter((id) => !before.has(id)));
  if (gd.done) animateDraw(svg);
  else if (added.size) animateDraw(svg, { only: added });
}

function guideAnswer(choice) {
  guideStep((gd) => gd.answer(choice));
}

function nextPractice() {
  const pool = EXAMPLES.filter((e) => e.text !== state.text);
  const ex = pool[Math.floor(Math.random() * pool.length)];
  input.value = ex.text;
  setText(ex.text, { animate: true });
}
$('pr-new').addEventListener('click', nextPractice);
$('pr-check').addEventListener('click', () => practice.check());
$('pr-reveal').addEventListener('click', () => practice.reveal());

$('theme-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  store.set('theme', b.dataset.board);
  setTheme(b.dataset.board, true);
});

function setTheme(name, animate) {
  state.theme = name;
  $('board').dataset.board = name;
  setSeg('theme-seg', 'board', name);
  measure = makeMeasurer(THEMES[name]);
  render({ animate });
  renderLegend($('glyphs'), THEMES[name], measure, loadSentence, name);
}

$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('reset').addEventListener('click', () => edit(() => ({ units: state.auto })));
$('replay').addEventListener('click', () => render({ animate: true, flip: true }));
$('zoom-in').addEventListener('click', () => { state.zoom = currentScale() * 1.2; applyZoom(); });
$('zoom-out').addEventListener('click', () => { state.zoom = Math.max(0.2, currentScale() / 1.2); applyZoom(); });
$('zoom-fit').addEventListener('click', () => { state.zoom = null; applyZoom(); });
const currentScale = () => (parseFloat(svg.style.width) || 1) / (+svg.dataset.w || 1);

const background = () => getComputedStyle($('board')).backgroundColor;

// A framed page can't start downloads itself; the host's `downloads`
// capability asks the viewer instead. Opened directly, a plain link works.
let saveFile = framed ? null : async (blob, name) => downloadLink(blob, name);
const showSave = () => { $('dl-svg').hidden = $('dl-png').hidden = !saveFile; };
showSave();
window.claude?.use?.('downloads').then((dl) => {
  if (!dl) return;
  saveFile = async (blob, filename) => {
    try {
      await dl.save({ filename, data: blob });
      toast(`Saved ${filename}`);
    } catch (err) {
      const code = err?.code;
      if (code === 'declined') return;
      if (code === 'rate_limited') toast('Another save is still waiting for your answer.');
      else if (code === 'too_large') toast('That file is too large to save here.');
      else {
        saveFile = null;
        showSave();
        toast('Saving files isn\u2019t available in this view.');
      }
    }
  };
  showSave();
}, () => {});

async function save(kind) {
  if (!state.units.length || !saveFile) return;
  const blob = kind === 'svg' ? await svgBlob(svg, background()) : await pngBlob(svg, background());
  await saveFile(blob, `${fileName(state.text)}.${kind}`);
}
$('dl-svg').addEventListener('click', () => save('svg'));
$('dl-png').addEventListener('click', () => save('png'));

$('share').hidden = framed;
$('share').addEventListener('click', async () => {
  saveHash();
  await new Promise((r) => setTimeout(r, 300));
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Link copied. It includes your edits.');
  } catch {
    toast('Copy the address bar to share this diagram.');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target === input || e.target.tagName === 'SELECT') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (e.key === 'Escape') select(null);
  else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected && state.mode !== 'guided') {
    edit((u) => (state.mode === 'scratch' ? detachTree(u, state.selected) : detach(u, state.selected)));
  }
});

new ResizeObserver(() => { if (state.zoom == null) applyZoom(); }).observe($('stage'));

// links pasted into the address bar of an open tab
window.addEventListener('hashchange', () => {
  const h = readHash();
  if (h && h.s !== state.text) {
    input.value = h.s;
    setText(h.s, { animate: true, fromHash: h });
  }
});

// ---------- boot ----------

if (!document.documentElement.lang) document.documentElement.lang = 'en';
renderExamples();
$('parser').value = state.parser === 'rules' ? 'rules' : 'server';
$('parser-wrap').hidden = framed;
const serverChecked = !framed && state.parser === 'server' ? checkServer() : Promise.resolve(false);
showParser();
$('board').dataset.board = state.theme;
setSeg('theme-seg', 'board', state.theme);

// until the reader picks a board, follow their light/dark setting
const followHost = () => {
  if (!store.get('theme', null) && hostBoard() !== state.theme) setTheme(hostBoard(), false);
  else render(); // the sentence markup takes its colours from the page theme
};
new MutationObserver(followHost).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', followHost);

const fontsReady = Promise.all([
  document.fonts.load('22px "Patrick Hand"'),
  document.fonts.load('20px "Newsreader"'),
  document.fonts.load('italic 15px "Newsreader"'),
]).catch(() => {});

Promise.all([fontsReady, serverChecked]).then(() => {
  measure = makeMeasurer(THEMES[state.theme]);
  renderLegend($('glyphs'), THEMES[state.theme], measure, loadSentence, state.theme);
  const fromHash = readHash();
  const text = fromHash?.s || EXAMPLES[0].text;
  input.value = text;
  setText(text, { animate: true, fromHash });
});
