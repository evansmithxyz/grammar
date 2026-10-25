// Guided mode's bar under the board: the current question, the sentence's
// words to answer with, what the last answer earned, and the help buttons.

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const LEAD = { wrong: 'Not quite.', hint: 'Hint.' };

export class GuideBar {
  constructor(root, { onAnswer, onHint, onShow, onRestart, onNew }) {
    this.root = root;
    this.el = (id) => root.querySelector(`#${id}`);
    root.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) {
        if (!chip.classList.contains('focus')) onAnswer(chip.dataset.none ? 'none' : chip.dataset.uids.split(' ').filter(Boolean));
        return;
      }
      const act = e.target.closest('button[data-act]')?.dataset.act;
      ({ hint: onHint, show: onShow, restart: onRestart, new: onNew })[act]?.();
    });
  }

  render({ text, tokens, guide, feedback }) {
    const st = guide.step;
    const n = guide.steps.length;
    this.el('guide-count').textContent = guide.done ? `All ${n} steps done` : `Step ${guide.i + 1} of ${n}`;
    this.el('guide-fill').style.width = `${(guide.i / Math.max(1, n)) * 100}%`;

    if (guide.done) {
      const first = guide.results.filter((r) => r === 'first').length;
      const shown = guide.results.filter((r) => r === 'shown').length;
      this.el('guide-q').textContent = first === n ? 'Diagrammed, and every answer right the first time.' : 'Diagrammed.';
      this.el('guide-ask').textContent = `${first} of ${n} right on the first try${shown ? `, ${shown} shown` : ''}. Try another sentence, or switch to From scratch to build one without the questions.`;
    } else {
      this.el('guide-q').textContent = st.title;
      this.el('guide-ask').textContent = st.ask;
    }

    // the sentence, word by word; a contraction's halves share one chip
    const unitOf = new Map();
    for (const u of guide.key) for (const i of u.tokens) unitOf.set(i, u);
    const chips = [];
    for (const t of tokens) {
      const u = unitOf.get(t.i);
      if (t.end <= t.start && chips.length) { if (u) chips.at(-1).uids.push(u.id); continue; }
      chips.push({ text: text.slice(t.start, t.end), uids: u ? [u.id] : [] });
    }
    const box = this.el('guide-words');
    box.replaceChildren();
    for (const c of chips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = c.text;
      b.dataset.uids = c.uids.join(' ');
      if (c.uids.length && c.uids.every((id) => guide.placed.has(id))) b.classList.add('placed');
      if (st?.focus && c.uids.some((id) => st.focus.includes(id))) {
        b.classList.add('focus');
        b.title = 'What you’re placing';
      }
      if (guide.narrow && !c.uids.some((id) => guide.narrow.has(id))) b.classList.add('dim');
      b.disabled = guide.done;
      box.append(b);
    }
    if (st?.none) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip none';
      b.dataset.none = '1';
      b.textContent = st.none;
      if (guide.narrow && !guide.narrow.has('none')) b.classList.add('dim');
      box.append(b);
    }

    const fb = this.el('guide-feedback');
    fb.className = `guide-feedback${feedback ? ` ${feedback.type}` : ''}`;
    fb.innerHTML = feedback ? `${LEAD[feedback.type] ? `<b>${LEAD[feedback.type]}</b> ` : ''}${esc(feedback.text)}` : '';

    this.el('gd-hint').hidden = this.el('gd-show').hidden = guide.done;
    this.el('gd-new').classList.toggle('primary', guide.done);
  }

  /** Flash the chips that were just clicked green or red. */
  flash(ids, type) {
    if (!ids?.length || (type !== 'right' && type !== 'partial' && type !== 'wrong')) return;
    const cls = type === 'wrong' ? 'wrong' : 'right';
    for (const b of this.root.querySelectorAll('.chip[data-uids]')) {
      if (!b.dataset.uids.split(' ').some((id) => ids.includes(id))) continue;
      b.classList.add(cls);
      setTimeout(() => b.classList.remove(cls), 700);
    }
  }
}
