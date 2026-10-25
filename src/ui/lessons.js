// The lesson bar above the board in Guided, Practice and From scratch: pick a
// level, see what it teaches, and move through its sentences. One dot per
// sentence fills in once it's been finished in the current mode.
import { LEVELS } from '../levels.js';

export class LessonBar {
  constructor(root, { onLevel, onPick }) {
    this.root = root;
    this.select = root.querySelector('#level');
    this.about = root.querySelector('#level-about');
    this.dots = root.querySelector('#level-dots');
    this.count = root.querySelector('#level-count');
    this.select.append(new Option('Mixed examples', ''));
    LEVELS.forEach((l, k) => this.select.append(new Option(`${k + 1}. ${l.title}`, l.id)));
    this.select.addEventListener('change', () => onLevel(this.select.value || null));
    this.dots.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) onPick(+b.dataset.i);
    });
  }

  /** current: the index in the level of the sentence on the board, or -1. done: a Set of indexes. */
  render({ levelId, current, done }) {
    const level = LEVELS.find((l) => l.id === levelId);
    this.select.value = level ? level.id : '';
    this.about.textContent = level ? level.about : 'A random sentence from the examples each time.';
    this.dots.replaceChildren();
    this.dots.hidden = this.count.hidden = !level;
    if (!level) return;
    level.sentences.forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dot';
      b.dataset.i = i;
      b.title = s;
      b.setAttribute('aria-label', `Sentence ${i + 1}${done.has(i) ? ' (done)' : ''}: ${s}`);
      if (done.has(i)) b.classList.add('done');
      if (i === current) b.setAttribute('aria-current', 'true');
      this.dots.append(b);
    });
    this.count.textContent = `${done.size} of ${level.sentences.length} done`;
  }
}
