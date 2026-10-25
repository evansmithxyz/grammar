// Small closed-class word lists the tagger and parser lean on.
// Compromise gets open-class words (nouns, verbs, adjectives) right most of the
// time; these lists fix up the function words it is shakier about.

const set = (s) => new Set(s.trim().split(/\s+/));

export const COORDINATORS = set('and or but nor yet so');

export const SUBORDINATORS = set(`
  after although as because before if once since though unless until till
  when whenever where wherever whereas while whether lest
`);

export const RELATIVE_PRONOUNS = set('who whom whose which that');

export const WH_WORDS = set('who whom whose which what where when why how');

export const INTERJECTIONS = set(`
  oh ah wow hey ouch oops alas hooray hurray yay hmm um uh well yes no
  ugh whoa yikes gosh golly bravo hello hi goodbye bye please
`);

export const SUBJECT_PRONOUNS = set('i he she we they');

// Forms of be / have / do and the modals, used to read verb groups.
export const BE_FORMS = set("be am is are was were been being 's 're 'm");
export const HAVE_FORMS = set("have has had having 've 'd");
export const DO_FORMS = set('do does did');
export const MODALS = set("can could may might must shall should will would 'll ought");

// Verbs that take a subject complement (predicate noun / adjective).
export const LINKING_VERBS = set(`
  be seem become appear look feel sound taste smell grow remain stay turn
  prove get go keep
`);
// Of the linking verbs, the ones that take a predicate *noun* (not a direct object).
export const NOMINAL_LINKING = set('be seem become remain appear prove');

// Verbs whose second object is an object complement: "elected him president".
export const OBJ_COMPLEMENT_VERBS = set(`
  elect name call appoint make consider choose crown declare label dub
  paint keep leave find think render deem title nickname vote color colour
`);

// Verbs that take a noun clause as their object: "I know (that) he left".
export const CLAUSE_VERBS = set(`
  know think believe say hope wish feel guess suppose realize realise
  understand remember forget doubt notice see hear learn discover decide
  explain show prove agree mean admit claim suggest imagine expect fear
  pretend promise report reply insist wonder ask assume bet figure find
  tell worry predict argue deny confirm reckon trust recall regret note
`);

// Verbs that take an infinitive as their direct object: "I want to swim".
export const INFINITIVE_VERBS = set(`
  want need like love hate try decide hope plan learn begin start refuse
  agree promise expect forget remember prefer choose wish attempt intend
  manage offer pretend seem fail tend afford arrange ask beg claim dare
  deserve neglect prepare threaten volunteer wait continue
`);

// Verbs that take a gerund as their direct object: "I enjoy swimming".
export const GERUND_VERBS = set(`
  enjoy stop like love hate finish avoid keep mind quit consider suggest
  practice practise begin start miss imagine risk deny admit recommend
  delay postpone resist appreciate discuss mention prefer regret remember
  forget try continue dislike fancy
`);

// Nouns ending in -ing that are not gerunds.
export const ING_NOUNS = set(`
  thing nothing something anything everything king ring string wing spring
  morning evening building ceiling wedding clothing
  sibling darling pudding duckling earring stocking ping sling sting swing
  bling viking heading offspring lightning shilling lining
`);

// Single-word nouns that usually work adverbially: "We left yesterday".
export const ADVERBIAL_NOUNS = set(`
  today tonight yesterday tomorrow home tonite everyday
`);

export const NEGATIONS = set("not n't never");

// Subordinators that can open a reduced clause: "When sitting...", "If asked...".
export const REDUCING = set('when whenever while if though although once unless until till');

// Nouns an infinitive usually modifies: "the sole Power to try all Impeachments".
export const INFINITIVE_NOUNS = set(`
  power right way time chance ability need reason attempt decision plan desire
  opportunity permission authority place effort courage freedom duty wish
`);

// Adjectives that can follow their noun: "the Members present".
export const POSTPOSITIVE = set('present absent available involved concerned required possible responsible elect');

// Place words compromise calls adjectives that work as adverbs after a verb:
// "stay inside", "went abroad".
export const PLACE_ADVERBS = set(`
  inside outside indoors outdoors upstairs downstairs abroad overseas ahead
  nearby underground uphill downhill offshore
`);
