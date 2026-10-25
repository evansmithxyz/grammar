// Pointer-based dragging of words in the diagram. A short press is a click;
// moving past a few pixels picks the word up as a chip that can be dropped
// onto another word, or onto an empty slot (`.zone`) in build-from-scratch mode.
import { startGhost, coveredTarget } from './ghost.js';

const TARGETS = '.hit, .zone';

export function attachWordDrag(svg, h) {
  let start = null, ghost = null, target = null;

  const setTarget = (t) => {
    if (target === t) return;
    target?.classList.remove('target');
    target = t;
    target?.classList.add('target');
  };

  svg.addEventListener('pointerover', (e) => {
    if (start) return;
    const t = e.target.closest?.('.hit');
    h.onHover(t ? t.dataset.uid : null);
  });
  svg.addEventListener('pointerleave', () => { if (!start) h.onHover(null); });

  svg.addEventListener('pointerdown', (e) => {
    const t = e.target.closest?.('.hit');
    if (!t || e.button > 0) return;
    e.preventDefault();
    start = { x: e.clientX, y: e.clientY, uid: t.dataset.uid, id: e.pointerId, moved: false, from: t, down: e };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  });

  const aim = (e) => {
    ghost.move(e);
    const t = coveredTarget(ghost.el, TARGETS, e.clientX, e.clientY,
      (n) => n.dataset.uid !== start.uid && h.canDrop(start.uid, n));
    setTarget(t);
  };

  function move(e) {
    if (!start || e.pointerId !== start.id) return;
    if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    if (!start.moved) {
      start.moved = true;
      ghost = startGhost(h.label(start.uid), start.down, start.from);
      svg.classList.add('dragging');
      h.onDragStart?.(start.uid);
    }
    aim(e);
  }

  function up(e) {
    if (!start || e.pointerId !== start.id) return;
    if (start.moved) aim(e); // decide from where the chip ends up
    const s = start;
    const t = target;
    cleanup();
    if (!s.moved) h.onClick(s.uid);
    else if (t) h.onDrop(s.uid, t, e.clientX, e.clientY);
    else if (!h.onDropElsewhere?.(s.uid, e.clientX, e.clientY)) h.onDragEnd?.();
  }
  function cancel() { cleanup(); h.onDragEnd?.(); }

  function cleanup() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    ghost?.remove();
    ghost = null;
    setTarget(null);
    svg.classList.remove('dragging');
    start = null;
  }
}
