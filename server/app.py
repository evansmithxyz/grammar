"""Sentence Diagrammer parse server.

Runs a spaCy pipeline (the transformer model by default) and returns, for
every token, its part of speech, its head and the dependency label joining
them. The web app turns that into a Reed-Kellogg diagram.

Run from the project root:
    server\\.venv\\Scripts\\python -m uvicorn app:app --app-dir server --port 8000

Set SPACY_MODEL to use a different pipeline (e.g. en_core_web_sm, which is
far smaller and faster but less accurate).
"""

import os
import time

import spacy
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

MODEL = os.environ.get("SPACY_MODEL", "en_core_web_trf")
MAX_CHARS = 1000

# Loading takes a few seconds, so do it once when the server starts.
nlp = spacy.load(MODEL, exclude=["ner"])

app = FastAPI(title="Sentence Diagrammer parser")
app.add_middleware(
    CORSMiddleware,
    # the Vite dev server and `vite preview`
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ParseRequest(BaseModel):
    text: str = Field(..., max_length=MAX_CHARS)


def model_info():
    return {"name": f"{nlp.meta['lang']}_{nlp.meta['name']}", "version": nlp.meta["version"]}


@app.get("/")
def index():
    return {"service": "Sentence Diagrammer parser", "model": model_info(), "parse": "POST /parse {\"text\": \"...\"}"}


@app.get("/health")
def health():
    return {"ok": True, "model": model_info()}


@app.post("/parse")
def parse(req: ParseRequest):
    text = req.text
    if not text.strip():
        raise HTTPException(status_code=400, detail="Send some text to parse.")
    started = time.perf_counter()
    doc = nlp(text)
    sent_of = {}
    for s_index, sent in enumerate(doc.sents):
        for tok in sent:
            sent_of[tok.i] = s_index
    tokens = [
        {
            "i": t.i,
            "text": t.text,
            "start": t.idx,
            "end": t.idx + len(t.text),
            "ws": t.whitespace_,
            "lemma": t.lemma_,
            "pos": t.pos_,  # coarse: NOUN, VERB, ADP, ...
            "tag": t.tag_,  # fine, Penn Treebank: NN, VBD, IN, ...
            "dep": t.dep_,  # ClearNLP labels: nsubj, dobj, prep, pobj, ...
            "head": t.head.i,
            "sent": sent_of.get(t.i, 0),
        }
        for t in doc
    ]
    return {
        "model": model_info(),
        "ms": round((time.perf_counter() - started) * 1000, 1),
        "tokens": tokens,
    }
