# Sentence Grapher

Type a sentence and watch it diagrammed Reed–Kellogg style, live in the browser. Then argue with it: drag any word onto
another to re-attach it, or click a word to change its job.

A few JavaScript effects do real work here: [Rough.js](https://roughjs.com) draws the diagram by hand, the sentence is
marked up like a teacher's red pen (in the spirit of Rough Notation), lines draw themselves so you see the structure
being built, and words fly from the sentence into their slots (a FLIP animation with the Web Animations API).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # parser, layout and robustness tests (node --test)
npm run build    # static site in dist/
npm run build:artifact  # also writes dist/artifact.html for publishing as a claude.ai Artifact
```

`dist/` is plain static files; any static host works.

## Optional: the spaCy parse server

The built-in parser is a set of hand-written rules. For better parses, run spaCy's transformer model
(`en_core_web_trf`, RoBERTa-based) on a local server and the app will use it.

One-time setup (Python 3.12; about 1 GB of downloads, mostly PyTorch and the model):

```bash
uv venv server/.venv --python 3.12 --seed
uv pip install --python server/.venv/Scripts/python.exe -r server/requirements.txt
server/.venv/Scripts/python.exe -m spacy download en_core_web_trf
```

Then run it alongside `npm run dev`:

```bash
npm run server   # http://localhost:8000
```

Pick **Parser → spaCy server** under the sentence box (it's the default when the server is reachable). While you
type, the in-browser parse draws instantly and the server's parse replaces it a moment later. If the server isn't
running, the app says so and falls back to the built-in rules; press Enter after starting it to reconnect.

- `server/app.py` returns each token's part of speech, head and dependency label. `SPACY_MODEL=en_core_web_sm`
  swaps in spaCy's small model (12 MB, much faster, less accurate).
- `src/nlp/spacy.js` converts that into the app's sentence model. spaCy's English labels are close to Reed–Kellogg
  already (prepositions head their objects, linking verbs head their complements), so it mostly merges helping verbs
  into their verb ("has been running") and relabels.
- Point the app at another address with `VITE_PARSER_URL=http://host:port npm run dev`.
- The published claude.ai Artifact can't reach a server (its frame blocks requests to other hosts), so it always
  uses the built-in rules.
- `node scripts/capture-spacy.mjs` (with the server running) refreshes `tests/fixtures/spacy.json`, which the
  conversion tests use so they run without the server.

## Put it on a server

`scripts/deploy.sh` puts the site and the parse server on a Debian or Ubuntu VPS over SSH. Caddy serves the site
and passes `/api` to the parse server, so both live at one address and the page finds the parser on its own.

```bash
scripts/deploy.sh root@203.0.113.7 --setup   # first time: installs Caddy, Python, spaCy and the model
scripts/deploy.sh root@203.0.113.7           # later: uploads the new build and server code
```

- Run it from Git Bash. It needs SSH key login to the server (`ssh-copy-id root@203.0.113.7` sets that up).
- The first run picks the parse model from the server's memory: the transformer (`en_core_web_trf`) with 4 GB or
  more, the small model otherwise. `MODEL=en_core_web_sm scripts/deploy.sh … --setup` overrides it.
- With a domain pointed at the server, `DOMAIN=grapher.example.com scripts/deploy.sh … --setup` switches Caddy to
  that name, and it fetches an HTTPS certificate by itself.
- The parse server runs as the systemd service `sentence-grapher-parser`; its log is
  `journalctl -u sentence-grapher-parser`. The site lives in `/srv/sentence-grapher`, the server in
  `/opt/sentence-grapher`, and the config in `deploy/`.

## What it does

- **Live diagrams.** The sentence is parsed as you type. Press Enter (or pick an example) to replay the drawing: lines
  are drawn like pen strokes and words fly down from the sentence into their slots.
- **Reed–Kellogg conventions.** Subject | verb on the baseline, direct objects behind a short divider, subject and
  object complements behind a backslash, modifiers on slants, prepositional phrases, indirect objects on an empty slant,
  appositives in parentheses, compound parts as forks with the conjunction on a dashed line, compound sentences joined
  by a dashed step, adverb and adjective clauses on their own baselines tied in with dashed lines, and noun clauses,
  infinitives and gerunds raised on pedestals. Understood subjects show as *(you)*.
- **Editing.** Drag a word onto another word to make it hang from that word. Click a word to see what it's doing in plain
  English, change its role, re-attach it from a menu, join it with the next word ("New" + "York"), split a group, or
  detach it. Undo/redo with Ctrl+Z / Ctrl+Shift+Z.
- **Sentence markup.** Above the board, the sentence is marked the way a teacher would on paper: subject underlined
  once, verb twice, objects circled, complements boxed, prepositional phrases in parentheses.
- **Arcs view.** The same parse as dependency arcs, for people who think of "graphing" a sentence as a syntax graph.
- **Guided mode.** Diagram a sentence the way it's taught in class, one question at a time: find the verb, then the
  subject ("who or what jumped?"), then what completes the verb ("the fox jumped whom or what?", or nothing), then
  where each other word hangs, then the same for every clause. Answer by clicking a word under the board, in the
  sentence or on the diagram; the diagram builds itself and the sentence is marked up as you go. A wrong answer is
  explained from what the word really does ("“dog” is inside the phrase “over the lazy dog”. The subject is never
  inside a prepositional phrase."). Hint gives the question to ask yourself, then narrows the choices to three;
  Show me answers the step.
- **Practice mode.** The lines are drawn and the words are missing. Drag tiles into the slots and check your work.
- **From scratch.** Nothing is drawn. Drag the main verb onto the board to start the baseline, then drag each word onto
  the word it belongs to and pick its job; the diagram grows as you go. Check grades each word against the parser's
  answer (compound parts may come in any order). Drag a word back to the tray to remove it and everything hanging from it.
- **Three boards.** Chalkboard, notebook paper and textbook print. The page itself follows your light/dark setting.
  A diagram bigger than the board can be dragged around by its empty parts (or scrolled); on notebook paper the
  ruled page moves with it.
- **Share and export.** "Link" copies a URL that includes your edits. SVG and PNG exports embed the fonts they use.

## How it works

```
text ─▶ tagger ─▶ parser ─▶ graph ─▶ layout ─▶ renderer
        (compromise    (rules)    (units +    (blocks +    (SVG, Rough.js)
         + fixes)                  relations)  collisions)
```

- `src/nlp/tagger.js`: runs [compromise](https://github.com/spencermountain/compromise) and maps its tags to a small set
  of parts of speech, fixing the cases it gets wrong for this job (gerunds, possessive *her*, place adverbs, verbs it
  calls nouns after a conjunction).
- `src/nlp/parser.js`: a hand-written recursive parser for the patterns a grammar class covers: compound parts,
  objects, complements, phrases, verbals, relative/adverb/noun clauses, questions, imperatives and expletives. When a
  parse comes out without a main verb or with loose pieces, it re-tags likely verbs and keeps the better parse.
- `src/model/graph.js`: the shared model. A sentence is a set of *units* (one or more tokens drawn as one word, like
  "has been running") that each point at a head unit with a relation. Edits (`src/model/edit.js`) only change heads,
  relations and grouping, so any edited graph can still be drawn.
- `src/diagram/layout.js`: the Reed–Kellogg layout. Everything is a block of primitives plus collision rectangles;
  parents place children by sliding them until they clear what's already placed. Pedestals and subordinate clauses are
  placed once the clause around them is known.
- `src/model/guided.js`: guided mode. Turns the parse into an ordered list of questions, checks answers, and writes
  the explanation for a wrong one from the clicked word's real job. The diagram shown is the parse cut down to what
  the learner has found so far.
- `src/diagram/render.js`, `arcs.js`, `themes.js`: SVG output, the arc view and the three styles.
- `src/ui/*`: the sentence strip, inspector, Key panel, drag and drop, practice mode and export.

## Limits

The parser is a set of rules, not a trained model, so some sentences come out wrong. Prepositional-phrase attachment
is a guess ("I saw the man with the telescope"), and constructions like comparisons ("taller than his brother"),
ellipsis, clefts and absolute phrases are drawn approximately. That's what the editing is for: drag the pieces where
they belong.

## Open questions

- **Practice box sizes.** Each empty box in Practice is sized to its word, which is a strong hint about which word goes
  where. That's fine for the easy mode; revisit later (equal-width boxes, or a harder Practice variant). Noted 2026-10-24.
