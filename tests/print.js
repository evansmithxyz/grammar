// Debug helper: node tests/print.js "Some sentence."
import { parse } from '../src/nlp/parser.js';
import { Graph } from '../src/model/graph.js';

export function treeString(text) {
  const { tokens, units } = parse(text);
  const g = new Graph(tokens, units);
  const lines = [];
  const walk = (u, depth) => {
    lines.push(`${'  '.repeat(depth)}${u.rel}: ${g.text(u)}${u.understood ? ' (understood)' : ''} [${u.pos}]`);
    for (const k of g.kids(u)) walk(k, depth + 1);
  };
  for (const r of g.roots()) walk(r, 0);
  return lines.join('\n');
}

/** Flat "rel(head)=dep" facts, handy for assertions. */
export function facts(text) {
  const { tokens, units } = parse(text);
  const g = new Graph(tokens, units);
  return units.map((u) => `${u.rel}(${u.head ? g.text(g.get(u.head)) : ''})=${g.text(u)}`);
}

if (process.argv[1] && process.argv[1].endsWith('print.js')) {
  for (const s of process.argv.slice(2)) console.log(`\n# ${s}\n${treeString(s)}`);
}
