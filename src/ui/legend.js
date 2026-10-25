import { parse } from '../nlp/parser.js';
import { Graph } from '../model/graph.js';
import { layoutGraph } from '../diagram/layout.js';
import { renderDiagram } from '../diagram/render.js';

// The Key: each line type, drawn by the real renderer from a tiny sentence.
const ITEMS = [
  { title: 'Subject | verb', text: 'Birds sing.', body: 'The baseline holds the core. A divider that cuts through it separates subject from verb.' },
  { title: 'Direct object', text: 'Dogs chase cats.', body: 'After the verb, behind a short upright line that stops at the baseline.' },
  { title: 'Subject complement', text: 'She seems happy.', body: 'After a linking verb, behind a line that leans back toward the subject.' },
  { title: 'Modifiers', text: 'The old dog barked loudly.', body: 'Adjectives, articles and adverbs sit on slants under the word they modify.' },
  { title: 'Prepositional phrase', text: 'Birds sat on the wire.', body: 'The preposition rides a slant down to a flat line holding its object.' },
  { title: 'Indirect object', text: 'I sent her a letter.', body: 'Drawn like a prepositional phrase with no preposition.' },
  { title: 'Compound parts', text: 'Cats and dogs play.', body: 'The line forks. A dashed line joins the parts and carries the conjunction.' },
  { title: 'Adverb clause', text: 'We stayed because it rained.', body: 'The clause gets its own baseline, tied on by a dashed line carrying the subordinator.' },
  { title: 'Pedestal', text: 'I like to swim.', body: 'Noun clauses, infinitives and gerunds used as nouns stand on a pedestal above their slot.' },
  { title: 'Understood subject', text: 'Sit down.', body: 'Commands have an unspoken “you”, written in parentheses in the subject slot.' },
];

export function renderLegend(root, theme, measure, onTry, board) {
  root.replaceChildren();
  for (const it of ITEMS) {
    const item = document.createElement('article');
    item.className = 'key-item';
    const mini = document.createElement('div');
    mini.className = 'board mini';
    mini.dataset.board = board;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Diagram of “${it.text}”`);
    mini.append(svg);
    const h = document.createElement('h4');
    h.textContent = it.title;
    const p = document.createElement('p');
    p.textContent = it.body;
    const b = document.createElement('button');
    b.textContent = `Diagram “${it.text}”`;
    b.addEventListener('click', () => onTry(it.text));
    item.append(mini, h, p, b);
    root.append(item);
    // drawn once in the DOM, so the renderer can measure its text
    const { tokens, units } = parse(it.text);
    const g = new Graph(tokens, units);
    renderDiagram(svg, layoutGraph(g, measure), g, theme);
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.querySelector('.hits')?.remove();
  }
}
