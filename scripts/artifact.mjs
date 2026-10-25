// Turns dist/index.html into dist/artifact.html for publishing as a claude.ai
// Artifact. The host supplies the doctype, <head> and <body>, so the page is
// written as plain content: title and stylesheet first, then the markup, then
// the script. Run after `vite build` (npm run build:artifact).
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const first = (re) => (html.match(re) || [])[0] || '';
const all = (re) => html.match(re) || [];

const body = /<body>([\s\S]*)<\/body>/.exec(html);
if (!body) throw new Error('dist/index.html has no <body>; run vite build first');

const page = [
  first(/<title>[\s\S]*?<\/title>/),
  '<meta name="claude:viewport-fit-sides" content="cover">',
  first(/<meta name="description"[^>]*>/),
  ...all(/<link rel="stylesheet"[^>]*>/g),
  body[1].trim(),
  ...all(/<script type="module"[^>]*><\/script>/g),
].filter(Boolean).join('\n');

writeFileSync('dist/artifact.html', `${page}\n`);
console.log(`dist/artifact.html written (${(page.length / 1024).toFixed(1)} kB)`);
