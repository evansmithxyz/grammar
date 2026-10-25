// Example sentences, grouped the way a grammar unit usually builds up.
// Every one of these is covered by tests/examples.test.js so the parser keeps
// drawing them correctly.

export const EXAMPLES = [
  { group: 'basics', text: 'The quick brown fox jumped over the lazy dog.' },
  { group: 'basics', text: 'The very tall man walked slowly and carefully.' },
  { group: 'basics', text: 'She looks happy.' },
  { group: 'objects', text: 'She gave her brother a book.' },
  { group: 'objects', text: 'They elected him president.' },
  { group: 'objects', text: 'We painted the house red.' },
  { group: 'compound', text: 'John and Mary washed the car and waxed the truck.' },
  { group: 'compound', text: 'The children laughed, sang, and danced.' },
  { group: 'compound', text: 'I like tea, but she likes coffee.' },
  { group: 'phrases', text: 'The girl with the red hat sang a song to her mother.' },
  { group: 'phrases', text: 'My brother, a doctor, lives in New York.' },
  { group: 'phrases', text: 'She went to the store to buy milk and eggs.' },
  { group: 'phrases', text: 'The dog barking at the cat is mine.' },
  { group: 'verbals', text: 'Swimming in the lake is fun.' },
  { group: 'verbals', text: 'I want to swim in the lake.' },
  { group: 'verbals', text: 'I enjoy reading books about history.' },
  { group: 'clauses', text: 'When the bell rang, the students left quickly.' },
  { group: 'clauses', text: 'The man who lives next door is a doctor.' },
  { group: 'clauses', text: 'I know that he is right.' },
  { group: 'clauses', text: 'The book that I read was boring.' },
  { group: 'questions', text: 'Did you see the dog?' },
  { group: 'questions', text: 'What did you see?' },
  { group: 'questions', text: "Don't touch the stove!" },
  { group: 'questions', text: 'Wow, that was amazing!' },
];

export const GROUPS = ['basics', 'objects', 'compound', 'phrases', 'verbals', 'clauses', 'questions'];

export const GROUP_LABELS = {
  basics: 'Subjects, verbs and modifiers',
  objects: 'Objects and complements',
  compound: 'Compound parts',
  phrases: 'Phrases',
  verbals: 'Infinitives and gerunds',
  clauses: 'Clauses',
  questions: 'Questions, commands and exclamations',
};
