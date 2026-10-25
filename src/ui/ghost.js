// Dragging a word: a floating chip that stays where the pointer picked it up,
// and the drop target that chip covers most. People aim the chip, not the tip
// of the pointer, so that is what decides where a word lands.

/** Start a chip for `text`, held at the spot where `e` grabbed `from`. */
export function startGhost(text, e, from) {
  const el = document.createElement('div');
  el.className = 'drag-ghost';
  el.textContent = text;
  document.body.appendChild(el);
  const r = from?.getBoundingClientRect();
  const fx = r && r.width ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0.5;
  const fy = r && r.height ? Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) : 0.5;
  const ox = fx * el.offsetWidth, oy = fy * el.offsetHeight;
  const move = (ev) => {
    el.style.left = `${ev.clientX - ox}px`;
    el.style.top = `${ev.clientY - oy}px`;
  };
  move(e);
  return { el, move, remove: () => el.remove() };
}

/**
 * The element matching `selector` that the chip covers most, sampled on a
 * grid across the chip (so slanted targets count by their real shape). Falls
 * back to whatever is under the pointer.
 */
export function coveredTarget(ghost, selector, x, y, accept = () => true) {
  const g = ghost.getBoundingClientRect();
  const tally = new Map();
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 3; j++) {
      const px = g.left + (g.width * (i + 0.5)) / 5, py = g.top + (g.height * (j + 0.5)) / 3;
      const el = document.elementsFromPoint(px, py).find((n) => n.matches?.(selector) && accept(n));
      if (el) tally.set(el, (tally.get(el) || 0) + 1);
    }
  }
  let best = null, most = 0;
  for (const [el, n] of tally) if (n > most) { best = el; most = n; }
  return best || document.elementsFromPoint(x, y).find((n) => n.matches?.(selector) && accept(n)) || null;
}
