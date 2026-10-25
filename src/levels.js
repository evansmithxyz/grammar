// Sentence sets for Guided, Practice and From scratch, in the order a grammar
// unit builds up: each level adds one new part of the diagram. Every sentence
// is checked in tests/levels.test.js, against both the built-in parser and
// recorded spaCy parses, so a lesson never teaches a wrong answer.

export const LEVELS = [
  {
    id: 'sv',
    title: 'Subjects and verbs',
    about: 'Who or what does something, and what they do: the baseline and its divider.',
    sentences: ['Birds sing.', 'The baby cried.', 'Snow fell.', 'The bell rang.', 'Dogs bark.', 'The children laughed.'],
  },
  {
    id: 'mods',
    title: 'Adjectives and adverbs',
    about: 'Words that describe hang on slants under the word they describe.',
    sentences: [
      'The tall man walked slowly.',
      'A small brown bird sang sweetly.',
      'The old car stopped suddenly.',
      'My little sister giggled.',
      'The very tired runner finally stopped.',
      'Two hungry cats meowed loudly.',
    ],
  },
  {
    id: 'dobj',
    title: 'Direct objects',
    about: 'What receives the action sits after the verb, behind a short line.',
    sentences: [
      'The dog chased the cat.',
      'She wrote a long letter.',
      'We planted three trees.',
      'The boy kicked the red ball.',
      'My father fixed the old fence.',
      'They sold their house.',
    ],
  },
  {
    id: 'pred',
    title: 'Linking verbs and complements',
    about: 'After a linking verb, a word that renames or describes the subject, behind a slanted line.',
    sentences: [
      'She looks happy.',
      'The soup smells delicious.',
      'My uncle is a pilot.',
      'The sky became dark.',
      'Those flowers are roses.',
      'He seems tired.',
    ],
  },
  {
    id: 'prep',
    title: 'Prepositional phrases',
    about: 'A preposition on a slant, its object on a flat line, hanging under the word the phrase describes.',
    sentences: [
      'The cat slept on the sofa.',
      'The girl with the red hat sang.',
      'We walked to the park after lunch.',
      'The book on the table is mine.',
      'He swam across the river.',
      'A man in a blue coat waved at us.',
    ],
  },
  {
    id: 'objs',
    title: 'Indirect objects and object complements',
    about: 'To whom something is done, and words that rename or describe the object.',
    sentences: [
      'She gave her brother a book.',
      'The teacher handed each student a pencil.',
      'They elected him president.',
      'We painted the house red.',
      'Grandma sent me a letter.',
      'We named him Buddy.',
    ],
  },
  {
    id: 'compound',
    title: 'Compound parts',
    about: 'Two or more subjects, verbs or objects joined by a conjunction split the line into a fork.',
    sentences: [
      'John and Mary washed the car.',
      'The children laughed and sang.',
      'She bought apples and oranges.',
      'We swam, ran, and biked.',
      'Tom and his sister cleaned the kitchen.',
      'The dog barked and growled at the mailman.',
    ],
  },
  {
    id: 'sentences',
    title: 'Compound sentences',
    about: 'Two whole clauses joined by a conjunction, stacked and tied by a dashed step.',
    sentences: [
      'I like tea, but she likes coffee.',
      'The rain stopped, and the sun came out.',
      'We waited, but the bus never came.',
      'She sang, and he played the piano.',
      'I called, but nobody answered.',
      'The wind howled, and the windows rattled.',
    ],
  },
  {
    id: 'special',
    title: 'Questions, commands and exclamations',
    about: 'Understood subjects, words that stand apart, and questions put back in order.',
    sentences: [
      'Did you see the dog?',
      'What did you see?',
      'Close the door.',
      "Don't touch the stove!",
      'Wow, that was amazing!',
      'There is a cat on the mat.',
    ],
  },
  {
    id: 'verbals',
    title: 'Infinitives, gerunds and participles',
    about: 'Verb forms doing other jobs, often raised on a pedestal or bent along a line.',
    sentences: [
      'I want to swim in the lake.',
      'Swimming in the lake is fun.',
      'The dog barking at the cat is mine.',
      'She went to the store to buy milk.',
      'She loves painting flowers.',
      'He likes to paint landscapes.',
    ],
  },
  {
    id: 'advcl',
    title: 'Adverb clauses',
    about: 'A clause that tells when, why or how gets its own baseline, tied in by a dashed line.',
    sentences: [
      'When the bell rang, the students left quickly.',
      'If it rains, we will stay inside.',
      'She smiled because she won.',
      'We left before the movie ended.',
      'Although he was tired, he finished the race.',
      'I will call you when I arrive.',
    ],
  },
  {
    id: 'relcl',
    title: 'Adjective clauses',
    about: 'A clause that describes a noun, tied to it from its relative pronoun.',
    sentences: [
      'The woman who called you is my aunt.',
      'The book that I read was boring.',
      'The girl who won the race smiled.',
      'The cake that she baked was delicious.',
      'People who exercise sleep better.',
      'The dog that bit me barked loudly.',
    ],
  },
  {
    id: 'nouncl',
    title: 'Noun clauses',
    about: 'A whole clause doing a noun’s job, standing on a pedestal in that spot.',
    sentences: [
      'I know that he is right.',
      'He said that he was sorry.',
      'She wondered whether it would rain.',
      'I believe that you can win.',
      'We know who did it.',
      'I wonder who called.',
    ],
  },
];

/** The level a sentence belongs to, and its place in it, if any. */
export function findLesson(text) {
  for (const level of LEVELS) {
    const index = level.sentences.indexOf(text);
    if (index >= 0) return { level, index };
  }
  return null;
}
