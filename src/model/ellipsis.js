// Reduced adverb clauses leave words out: "When sitting for that Purpose, they
// shall be on Oath" means "When [they are] sitting for that Purpose". Reed–
// Kellogg writes the missing words in parentheses, so supply them: an
// understood subject borrowed from the main clause, and the form of "be" the
// verb needs ("(they) | (are) sitting"). Works on either parser's output.

const REDUCERS = /^(when|whenever|while|if|though|although|once|unless|until|till)$/;
const PLURAL_PRONOUNS = /^(we|they|you|these|those)$/;

export function fillEllipsis(tokens, units) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const kids = (u, rel) => units.filter((k) => k.head === u.id && k.rel === rel);
  const words = (u) => (u.understood ? u.text : u.tokens.map((i) => tokens[i].text).join(' '));
  const added = [];

  for (const u of units) {
    if (u.rel !== 'advcl' || u.pos !== 'VERB' || u.understood || u.implied) continue;
    if (kids(u, 'subj').length || u.tokens.length !== 1) continue; // already has a subject or helpers
    const mark = kids(u, 'mark')[0];
    if (!mark || !REDUCERS.test(words(mark).toLowerCase())) continue;
    const verb = tokens[u.tokens[0]];
    const ing = /ing$/i.test(verb.text);
    const participle = !ing && (verb.tags.has('VBN') || verb.tags.has('Participle') || (verb.tags.has('PastTense') && /(ed|en|wn|ne)$/i.test(verb.text)));
    if (!ing && !participle) continue;

    // the main clause supplies the subject
    let main = byId.get(u.head);
    while (main && !kids(main, 'subj').length && main.rel === 'conj') main = byId.get(main.head);
    const subj = main ? kids(main, 'subj')[0] : null;
    let who = subj ? words(subj) : 'you';
    if (subj && !subj.understood && subj.pos === 'PRON' && who !== 'I') who = who.toLowerCase();
    const plural = subj
      ? PLURAL_PRONOUNS.test(who.toLowerCase()) || kids(subj, 'conj').length > 0
        || subj.tokens.some((i) => tokens[i].tags.has('NNS') || tokens[i].tags.has('NNPS') || tokens[i].tags.has('Plural'))
      : true;
    const past = !!main && main.tokens.some((i) => {
      const t = tokens[i];
      return /^(was|were|had|did)$/i.test(t.text) || t.tags.has('VBD') || (t.tags.has('PastTense') && !t.tags.has('Participle'));
    });
    u.implied = past ? (plural ? 'were' : 'was') : who === 'I' ? 'am' : plural ? 'are' : 'is';
    added.push({
      id: `u${units.length + added.length}`,
      tokens: [],
      understood: true,
      text: who,
      pos: 'PRON',
      rel: 'subj',
      head: u.id,
      sent: u.sent,
      order: Math.min(...u.tokens) - 0.5,
    });
  }
  units.push(...added);
  return units;
}
