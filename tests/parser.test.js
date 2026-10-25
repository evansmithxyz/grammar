import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facts } from './print.js';

// Each case lists facts that must appear in the parse, as rel(head)=dependent.
const CASES = {
  'The quick brown fox jumped over the lazy dog.': [
    'root()=jumped', 'subj(jumped)=fox', 'mod(fox)=quick', 'prep(jumped)=over', 'pobj(over)=dog', 'mod(dog)=lazy',
  ],
  'She gave her brother a book.': ['iobj(gave)=brother', 'dobj(gave)=book', 'mod(brother)=her'],
  "Don't touch the stove!": ['subj(do touch)=you', 'mod(do touch)=not', 'dobj(do touch)=stove'],
  'Did you see the dog?': ['root()=Did see', 'subj(Did see)=you', 'dobj(Did see)=dog'],
  'What did you see?': ['dobj(did see)=What', 'subj(did see)=you'],
  'The man who lives next door is a doctor.': ['relcl(man)=lives', 'subj(lives)=who', 'pred(is)=doctor'],
  'I know that he is right.': ['dobj(know)=is', 'mark(is)=that', 'pred(is)=right'],
  'I want to swim in the lake.': ['dobj(want)=swim', 'mark(swim)=to', 'prep(swim)=in'],
  'Swimming is fun.': ['subj(is)=Swimming', 'pred(is)=fun'],
  'When the bell rang, the students left quickly.': ['advcl(left)=rang', 'mark(rang)=When', 'subj(left)=students'],
  'I like tea, but she likes coffee.': ['conj(like)=likes', 'cc(likes)=but', 'subj(likes)=she'],
  'They elected him president.': ['dobj(elected)=him', 'ocomp(elected)=president'],
  'The very tall man walked slowly and carefully.': ['mod(tall)=very', 'conj(slowly)=carefully'],
  'John and Mary washed the car and waxed the truck.': ['conj(John)=Mary', 'conj(washed)=waxed', 'dobj(waxed)=truck'],
  'There is a cat on the mat.': ['expl(is)=There', 'subj(is)=cat'],
  'My brother, a doctor, lives in New York.': ['appos(brother)=doctor', 'pobj(in)=New York'],
  'Wow, that was amazing!': ['intj(was)=Wow', 'pred(was)=amazing'],
  'The dog barking at the cat is mine.': ['mod(dog)=barking', 'prep(barking)=at'],
  'She looks happy.': ['pred(looks)=happy'],
  'We painted the house red.': ['dobj(painted)=house', 'ocomp(painted)=red'],
  'He gave up smoking.': ['root()=gave up', 'dobj(gave up)=smoking'],
  'The book that I read was boring.': ['relcl(book)=read', 'dobj(read)=that', 'pred(was)=boring'],
  "John's dog has been running all day.": ['root()=has been running', 'npadv(has been running)=day'],
  'I told her that he left.': ['iobj(told)=her', 'dobj(told)=left', 'mark(left)=that'],
  'The house in which I live is old.': ['relcl(house)=live', 'pobj(in)=which'],
  'She is afraid of the dark.': ['prep(afraid)=of'],
  'The children laughed, sang, and danced.': ['conj(laughed)=sang', 'conj(laughed)=danced', 'cc(danced)=and'],
  'My dog and my cat sleep on the couch.': ['root()=sleep', 'conj(dog)=cat'],
  'To err is human.': ['subj(is)=err', 'mark(err)=To'],
  'I came, I saw, I conquered.': ['conj(came)=saw', 'conj(came)=conquered'],
  'If it rains tomorrow, we will stay inside.': ['advcl(will stay)=rains', 'mark(rains)=If'],
  'She went to the store to buy milk and eggs.': ['mod(went)=buy', 'dobj(buy)=milk', 'conj(milk)=eggs'],
  'I enjoy reading books about history.': ['dobj(enjoy)=reading', 'dobj(reading)=books'],
  'If it rains tomorrow, we will stay inside and play games.': ['mod(will stay)=inside', 'conj(will stay)=play', 'dobj(play)=games'],
  'We will stay home and play games.': ['npadv(will stay)=home', 'conj(will stay)=play'],
  'She bought apples and oranges at the market.': ['conj(apples)=oranges', 'prep(bought)=at'],
  'The big and friendly dog ran quickly and happily through the park.': ['conj(big)=friendly', 'conj(quickly)=happily'],
  'We walked over the bridge and through the quiet woods.': ['conj(over)=through', 'pobj(through)=woods'],
  'When sitting for that Purpose, they shall be on Oath or Affirmation.': [
    'advcl(shall be)=(are) sitting', 'mark((are) sitting)=When', 'subj((are) sitting)=they', 'prep((are) sitting)=for', 'conj(Oath)=Affirmation',
  ],
  'When the President of the United States is tried, the Chief Justice shall preside: And no Person shall be convicted without the Concurrence of two thirds of the Members present.': [
    'advcl(shall preside)=is tried', 'conj(shall preside)=shall be convicted', 'cc(shall be convicted)=And',
    'pobj(of)=thirds', 'mod(thirds)=two', 'mod(Members)=present',
  ],
  'The Senate shall have the sole Power to try all Impeachments.': ['dobj(shall have)=Power', 'mod(Power)=try', 'mark(try)=to'],
  'He fell asleep while reading the report.': ['advcl(fell)=(was) reading', 'subj((was) reading)=he', 'dobj((was) reading)=report'],
};

for (const [sentence, expected] of Object.entries(CASES)) {
  test(sentence, () => {
    const got = facts(sentence);
    for (const f of expected) assert.ok(got.includes(f), `missing ${f}\n  got: ${got.join(', ')}`);
    assert.ok(!got.some((f) => f.startsWith('float')), `unattached words: ${got.filter((f) => f.startsWith('float'))}`);
  });
}
