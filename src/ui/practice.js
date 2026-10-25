// Practice mode: the diagram's lines are drawn, the words are missing, and the
// learner drags word tiles into the slots.
import { startGhost, coveredTarget } from './ghost.js';

export class Practice {
  constructor({ tray, score, onChange }) {
    this.tray = tray;
    this.score = score;
    this.onChange = onChange;
    this.placed = new Map(); // slot uid -> tile index
    this.slots = [];
    this.tiles = [];
    this.checked = false;
  }

  /** Called after each render in practice mode with the freshly drawn slots. */
  mount(svg, slots, words) {
    this.svg = svg;
    this.slots = slots;
    if (!this.tiles.length || this.words !== words) {
      this.words = words;
      this.tiles = shuffle(slots.map((s, i) => ({ text: s.text, i })));
      this.placed.clear();
      this.checked = false;
    }
    this.renderTray();
    this.paint();
  }

  reset() {
    this.tiles = [];
    this.words = null;
  }

  renderTray() {
    this.tray.replaceChildren();
    const used = new Set(this.placed.values());
    for (const t of this.tiles) {
      const b = document.createElement('div');
      b.className = 'tile';
      b.textContent = t.text;
      b.dataset.i = t.i;
      if (used.has(t.i)) b.classList.add('used');
      b.addEventListener('pointerdown', (e) => this.drag(e, t, b));
      this.tray.appendChild(b);
    }
    this.updateScore();
  }

  paint() {
    for (const s of this.slots) {
      const ti = this.placed.get(s.uid);
      const tile = this.tiles.find((t) => t.i === ti);
      s.textEl.textContent = tile ? tile.text : s.text;
      s.textEl.setAttribute('visibility', tile ? 'visible' : 'hidden');
      s.rect.classList.toggle('filled', !!tile);
      s.rect.classList.remove('right', 'wrong');
      if (this.checked && tile) s.rect.classList.add(norm(tile.text) === norm(s.text) ? 'right' : 'wrong');
      s.rect.onclick = tile ? () => { this.placed.delete(s.uid); this.checked = false; this.renderTray(); this.paint(); } : null;
    }
  }

  drag(e, tile, from) {
    e.preventDefault();
    const ghost = startGhost(tile.text, e, from);
    let target = null;
    const pos = (ev) => {
      ghost.move(ev);
      const slot = coveredTarget(ghost.el, '.slot', ev.clientX, ev.clientY);
      if (target !== slot) { target?.classList.remove('target'); target = slot; target?.classList.add('target'); }
    };
    pos(e);
    const move = (ev) => pos(ev);
    const up = (ev) => {
      pos(ev);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.remove();
      target?.classList.remove('target');
      if (target) {
        this.placed.set(target.dataset.slot, tile.i);
        this.checked = false;
        this.renderTray();
        this.paint();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  check() {
    this.checked = true;
    this.paint();
    this.updateScore();
  }

  reveal() {
    this.placed.clear();
    const free = [...this.tiles];
    for (const s of this.slots) {
      const k = free.findIndex((t) => norm(t.text) === norm(s.text));
      if (k >= 0) { this.placed.set(s.uid, free[k].i); free.splice(k, 1); }
    }
    this.checked = true;
    this.renderTray();
    this.paint();
  }

  updateScore() {
    const total = this.slots.length;
    const filled = this.placed.size;
    if (!this.checked) { this.score.textContent = `${filled} / ${total} placed`; return; }
    let right = 0;
    for (const s of this.slots) {
      const tile = this.tiles.find((t) => t.i === this.placed.get(s.uid));
      if (tile && norm(tile.text) === norm(s.text)) right++;
    }
    this.score.textContent = right === total ? `All ${total} right. Nicely graphed.` : `${right} of ${total} right`;
  }
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9']/g, '');

function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  // avoid handing back the sentence in order
  if (r.length > 2 && r.every((t, k) => t.i === k)) [r[0], r[1]] = [r[1], r[0]];
  return r;
}
