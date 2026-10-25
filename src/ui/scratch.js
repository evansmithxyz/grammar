// Build-from-scratch mode: the tray of words not yet placed, dragging a word
// from the tray onto the board, and the menu asking what job a dropped word does.
import { startGhost, coveredTarget } from './ghost.js';

export class ScratchTray {
  constructor({ tray, board, onDrop }) {
    this.tray = tray;
    this.board = board;
    this.onDrop = onDrop;
  }

  /** Show the unplaced words, in sentence order. */
  render(g, units) {
    this.tray.replaceChildren();
    for (const u of units) {
      const b = document.createElement('div');
      b.className = 'tile';
      b.textContent = u.understood ? `(${u.text})` : g.text(u);
      b.dataset.uid = u.id;
      b.title = 'Drag onto the board';
      b.addEventListener('pointerdown', (e) => this.drag(e, u.id, b.textContent, b));
      this.tray.append(b);
    }
    if (!units.length) {
      const done = document.createElement('p');
      done.className = 'tray-done';
      done.textContent = 'Every word is on the board. Press Check to see how you did.';
      this.tray.append(done);
    }
  }

  drag(e, uid, label, from) {
    if (e.button > 0) return;
    e.preventDefault();
    const ghost = startGhost(label, e, from);
    const svg = this.board.querySelector('svg');
    // the drawing area, not the tray under it
    const stage = this.board.querySelector('.stage');
    svg?.classList.add('dragging');
    let target = null, onBoard = false, moved = false;
    const at = (ev) => {
      ghost.move(ev);
      const hit = coveredTarget(ghost.el, '.hit, .zone', ev.clientX, ev.clientY);
      if (target !== hit) { target?.classList.remove('target'); target = hit; target?.classList.add('target'); }
      onBoard = !hit && document.elementsFromPoint(ev.clientX, ev.clientY).includes(stage);
      this.board.classList.toggle('drop-ready', onBoard);
    };
    at(e);
    const move = (ev) => {
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 4) moved = true;
      at(ev);
    };
    const up = (ev) => {
      at(ev);
      if (!moved) { target?.classList.remove('target'); target = null; onBoard = false; }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost.remove();
      svg?.classList.remove('dragging');
      target?.classList.remove('target');
      this.board.classList.remove('drop-ready');
      if (target || onBoard) this.onDrop(uid, { target, onBoard, x: ev.clientX, y: ev.clientY });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
}

/**
 * Ask what job a dropped word does. Resolves with the chosen relation, or
 * null if the menu is dismissed.
 */
export function chooseJob(menu, { x, y, word, head, choices, labels }) {
  return new Promise((resolve) => {
    menu.replaceChildren();
    const q = document.createElement('p');
    q.className = 'role-menu-q';
    q.textContent = `What does “${word}” do for “${head}”?`;
    const list = document.createElement('div');
    list.className = 'roles';
    for (const rel of choices) {
      const b = document.createElement('button');
      b.textContent = labels[rel] || rel;
      b.addEventListener('click', () => done(rel));
      list.append(b);
    }
    menu.append(q, list);
    menu.hidden = false;
    // beside the drop point, kept inside the window
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x + 12, innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y + 12, innerHeight - r.height - 8))}px`;
    list.firstChild?.focus();

    const key = (e) => { if (e.key === 'Escape') done(null); };
    const away = (e) => { if (!menu.contains(e.target)) done(null); };
    setTimeout(() => {
      document.addEventListener('keydown', key);
      document.addEventListener('pointerdown', away);
    });
    function done(v) {
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', away);
      menu.hidden = true;
      resolve(v);
    }
  });
}
