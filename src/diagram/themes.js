// Visual themes for the diagram. Each one sets the drawing style (hand-drawn
// with rough.js or crisp), the word font, and the role colours.

export const THEMES = {
  chalk: {
    label: 'Chalkboard',
    dark: true,
    rough: true,
    roughness: 1.15,
    bowing: 0.7,
    strokeWidth: 1.7,
    chalk: true,
    font: '"Patrick Hand", "Comic Sans MS", cursive',
    fontSize: 22,
    labelFont: '"Patrick Hand", cursive',
    labelSize: 17,
    ink: '#eef2e6',
    faint: 'rgba(238, 242, 230, 0.55)',
    roles: {
      subj: '#d4f05a',
      verb: '#ff9e7d',
      obj: '#8fd3ff',
      comp: '#d4a8ff',
      mod: '#f4ecd6',
      prep: '#7fe3c4',
      conn: '#ffb3d1',
    },
  },
  notebook: {
    label: 'Notebook',
    dark: false,
    rough: true,
    roughness: 0.75,
    bowing: 0.9,
    strokeWidth: 1.5,
    chalk: false,
    font: '"Patrick Hand", "Comic Sans MS", cursive',
    fontSize: 22,
    labelFont: '"Patrick Hand", cursive',
    labelSize: 17,
    ink: '#1f3b8f',
    faint: 'rgba(31, 59, 143, 0.5)',
    roles: {
      subj: '#3d7a00',
      verb: '#c2410c',
      obj: '#0369a1',
      comp: '#7e22ce',
      mod: '#1f3b8f',
      prep: '#0f766e',
      conn: '#be185d',
    },
  },
  print: {
    label: 'Textbook',
    dark: false,
    rough: false,
    strokeWidth: 1.4,
    chalk: false,
    font: '"Newsreader", Georgia, serif',
    fontSize: 20,
    labelFont: '"Newsreader", Georgia, serif',
    labelSize: 15,
    italicLabels: true,
    ink: '#1b1b1b',
    faint: 'rgba(27, 27, 27, 0.45)',
    roles: {
      subj: '#4d6b00',
      verb: '#b33a14',
      obj: '#0b5f8a',
      comp: '#6b2fa8',
      mod: '#1b1b1b',
      prep: '#0f6b5f',
      conn: '#a3175a',
    },
  },
};

/** Which colour family a relation belongs to. */
export function roleFamily(rel, pos) {
  switch (rel) {
    case 'subj': return 'subj';
    case 'root': return 'verb';
    case 'dobj': case 'iobj': case 'pobj': return 'obj';
    case 'pred': case 'ocomp': case 'appos': return 'comp';
    case 'prep': return 'prep';
    case 'cc': case 'mark': case 'intj': case 'expl': return 'conn';
    case 'conj': case 'advcl': case 'relcl':
      return pos === 'VERB' ? 'verb' : 'mod';
    default: return pos === 'VERB' ? 'verb' : 'mod';
  }
}

/** The family a unit is drawn in, following compound parts back to the first item. */
export function unitFamily(g, u) {
  // a verb with its own subject heads a clause: it's a verb whatever job the
  // clause does ("I know that he IS right", "except what MAY BE necessary")
  if (g.isVerbal(u) && g.kid(u, 'subj')) return 'verb';
  let cur = u;
  for (let n = 0; n < 20 && cur && cur.rel === 'conj'; n++) {
    const h = g.head(cur);
    if (!h) break;
    if (g.isVerbal(cur) && g.kid(cur, 'subj')) return 'verb';
    cur = h;
  }
  if (cur.rel === 'mod' && cur.pos === 'VERB') return 'mod';
  return roleFamily(cur.rel, cur.pos);
}
