// Drag the empty board to move around a diagram bigger than the board, like
// sliding a sheet of paper. Words, slots and drop zones keep their own drags,
// and touch screens already scroll with a finger, so this is for the mouse.

// things that start their own drag or click when pressed
const OWN = '.hit, .zone, .slot, button, a, input, select, textarea';

/** Returns a function to call after the diagram changes size, to update the cursor. */
export function attachPan(stage) {
  const scrollable = () => stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1;
  const sync = () => stage.classList.toggle('pannable', scrollable());
  new ResizeObserver(sync).observe(stage);
  let swallowClickUntil = 0;

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType !== 'mouse' || e.target.closest(OWN) || !scrollable()) return;
    // leave the scrollbars alone
    const box = stage.getBoundingClientRect();
    if (e.clientX - box.left - stage.clientLeft >= stage.clientWidth || e.clientY - box.top - stage.clientTop >= stage.clientHeight) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    let moved = false;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('panning');
    const move = (ev) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      stage.scrollLeft = start.left - dx;
      stage.scrollTop = start.top - dy;
    };
    const up = () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
      stage.classList.remove('panning');
      // a pan isn't a click on whatever it ended over
      if (moved) swallowClickUntil = performance.now() + 80;
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  });
  stage.addEventListener('click', (e) => {
    if (performance.now() < swallowClickUntil) e.stopPropagation();
  }, true);

  return sync;
}
