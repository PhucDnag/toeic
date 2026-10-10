const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(name) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib', name), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('exports', 'module', compiled)(loaded.exports, loaded);
  return loaded.exports;
}
const { RawListeningSession } = load('raw-listening.ts');
const { validateListeningResult } = load('raw-listening-response.ts');
const answer = (question = 'What dinner specials do you have today?', answer_text = 'We have baked salmon.') => ({
  question_number: null, question, answer_text, confidence: 0.9, reason: 'It names a dinner special.', translation: 'Đây là món đặc biệt hôm nay.',
});
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const session = new RawListeningSession();
  let context;
  session.onStateChange((state, value) => { context = { state, ...value }; });
  session.start();
  return { session, get: () => context };
}

test('raw unnumbered questions need no labels and answers persist while listening', async () => {
  const { session, get } = setup();
  session.setSolveCallback(async text => ({ consumed_text: text, answers: [answer()] }));
  session.processTranscript('What dinner specials do you have today? We have baked salmon. For the first time. No I have not.');
  await session.flush();
  assert.equal(get().currentAnswer.answerText, 'We have baked salmon.');
  assert.deepEqual(get().currentQuestion.choices, {});
  assert.equal(get().history.length, 1);
  assert.equal(get().state, 'ANSWER_READY');
  session.stop();
});

test('screenshot-like mixed transcript keeps unfinished next question out of prior answer', async () => {
  const { session, get } = setup();
  const complete = 'Number 8 What dinner specials do you have today? A. We have baked salmon. B. For the first time. C. No, I have not.';
  const tail = 'When will the order be delivered? A. Not until Wednesday afternoon. B.';
  const seen = [];
  session.setSolveCallback(async (text, context) => {
    seen.push({ text, context });
    return seen.length === 1 ? { consumed_text: complete, answers: [answer()] } : { consumed_text: text, answers: [answer('When will the order be delivered?', 'Not until Wednesday afternoon.')] };
  });
  session.processTranscript(`${complete} ${tail}`);
  await session.flush();
  assert.equal(get().history.length, 1);
  session.processTranscript('The blue one. C. At the station.');
  await session.flush();
  assert.equal(seen[1].text, `${tail} The blue one. C. At the station.`);
  assert.equal(seen[1].context, complete);
  assert.equal(get().history.length, 2);
  assert.equal(get().history[0].answerText, 'We have baked salmon.');
  session.stop();
});

test('speech arriving while solving is processed immediately without a display cooldown', async () => {
  const { session, get } = setup();
  let resolve;
  const seen = [];
  session.setSolveCallback(text => {
    seen.push(text);
    if (seen.length === 1) return new Promise(done => { resolve = done; });
    return Promise.resolve({ consumed_text: text, answers: [answer('Second question', 'Second answer')] });
  });
  session.processTranscript('First question and responses.');
  session.forceSolve();
  session.processTranscript('Second question and responses.');
  resolve({ consumed_text: seen[0], answers: [answer()] });
  await tick();
  assert.deepEqual(seen, ['First question and responses.', 'Second question and responses.']);
  assert.equal(get().history.length, 2);
  session.stop();
});

test('25 raw questions are answered once each, including multiple questions in one chunk', async () => {
  const { session, get } = setup();
  session.setSolveCallback(async text => ({ consumed_text: text, answers: text.split('|').map((q, i) => answer(q, `Reply ${i}`)) }));
  for (let i = 0; i < 5; i++) {
    session.processTranscript(Array.from({ length: 5 }, (_, j) => `Spoken prompt ${i * 5 + j}`).join('|'));
    await session.flush();
  }
  assert.equal(get().history.length, 25);
  assert.deepEqual(get().history.map(item => item.questionNumber), Array.from({ length: 25 }, (_, i) => i + 1));
  session.stop();
});

test('incomplete text is not polled and reset ignores a late result', async () => {
  const { session, get } = setup();
  let calls = 0;
  session.setSolveCallback(async () => { calls++; return { consumed_text: '', answers: [] }; });
  session.processTranscript('Where is');
  await session.flush();
  await tick();
  assert.equal(calls, 1);
  let resolve;
  session.setSolveCallback(() => new Promise(done => { resolve = done; }));
  session.processTranscript('the office?');
  session.forceSolve();
  session.reset();
  resolve({ consumed_text: 'Where is the office?', answers: [answer()] });
  await tick();
  assert.equal(get().history.length, 0);
  assert.equal(get().state, 'IDLE');
});

test('invalid model boundary cannot discard speech; a retry retains the original input', async () => {
  const { session, get } = setup();
  session.processTranscript('Original speech.');
  session.setSolveCallback(async () => ({ consumed_text: 'Rewritten speech.', answers: [answer()] }));
  await session.flush();
  assert.equal(get().history.length, 0);
  session.setSolveCallback(async text => {
    assert.equal(text, 'Original speech.');
    return { consumed_text: text, answers: [answer()] };
  });
  await session.flush();
  assert.equal(get().history.length, 1);
  session.stop();
  assert.throws(() => validateListeningResult({ consumed_text: 'Wrong', answers: [answer()] }, 'Original speech.'));
  assert.throws(() => validateListeningResult({ consumed_text: '', answers: [answer()] }, 'Original speech.'));
  assert.throws(() => validateListeningResult({ consumed_text: 'Original speech.', answers: [{ ...answer(), answer_text: '' }] }, 'Original speech.'));
});

test('all keys limited: retries automatically after cooldown, retains new speech, and reset cancels retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const { session, get } = setup();
  const seen = [];
  session.setSolveCallback(async text => {
    seen.push(text);
    if (seen.length === 1) throw Object.assign(new Error('limited'), { retryAfterMs: 10000 });
    return { consumed_text: text, answers: [answer()] };
  });
  session.processTranscript('First speech.');
  session.forceSolve(); await tick();
  session.processTranscript('More speech.');
  session.forceSolve();
  t.mock.timers.tick(9999); await tick();
  assert.equal(seen.length, 1);
  t.mock.timers.tick(1); await tick();
  assert.deepEqual(seen, ['First speech.', 'First speech. More speech.']);
  assert.equal(get().history.length, 1);
  session.setSolveCallback(async () => { throw Object.assign(new Error('limited'), { retryAfterMs: 10000 }); });
  session.processTranscript('Pending speech.'); session.forceSolve(); await tick();
  session.reset();
  t.mock.timers.tick(20000); await tick();
  assert.equal(get().state, 'IDLE');
  assert.equal(get().history.length, 0);
});

test('repeated numbered question updates one answer; different questions can share the same reply', async () => {
  const { session, get } = setup();
  let result = { ...answer('Which folder are the documents in?', 'Let me show you.'), question_number: 14 };
  session.setSolveCallback(async text => ({ consumed_text: text, answers: [result, result] }));
  session.processTranscript('Number 14 and its three responses.'); await session.flush();
  session.processTranscript('Number 14 repeated by transcription.'); await session.flush();
  assert.equal(get().history.length, 1);
  result = { ...result, question_number: 15 };
  session.processTranscript('Number 15 with the same correct response.'); await session.flush();
  assert.equal(get().history.length, 2);
  result = { ...result, question_number: 14, answer_text: 'I can show you.', confidence: 1 };
  session.processTranscript('An older corrected question.'); await session.flush();
  assert.equal(get().history.length, 2);
  assert.equal(get().currentQuestion.questionNumber, 15, 'late corrections must not replace the latest question');
  session.reset(); session.start();
  session.processTranscript('New test, number 14 again.'); await session.flush();
  assert.equal(get().history.length, 1);
  session.stop();
});

test('overlap timestamps remove old words even when Whisper changes their spelling', () => {
  const { selectTranscript } = load('transcription.ts');
  const transcript = { text: 'After three o clock C. About half of them.', words: [
    { word: 'After', start: 0, end: 0.2 }, { word: 'three', start: 0.2, end: 0.4 },
    { word: "o'clock.", start: 0.4, end: 0.8 }, { word: 'C.', start: 1, end: 1.2 },
    { word: 'About', start: 1.2, end: 1.4 }, { word: 'half', start: 1.4, end: 1.6 },
    { word: 'of', start: 1.6, end: 1.8 }, { word: 'them.', start: 1.8, end: 2 },
  ] };
  assert.deepEqual(selectTranscript(transcript, 0.8), { text: 'C. About half of them.', overlapRemoved: true });
  assert.equal(selectTranscript({ ...transcript, segments: [] }, 0.8).text, '');
  assert.deepEqual(selectTranscript({ text: 'New speech.' }, 0.8), { text: 'New speech.', overlapRemoved: false });
});

test('Part 2 waits for three actual responses, accepts indirect answers, and aligns punctuation without losing the next question', () => {
  const transcript = 'Number 14 Which folder are the documents in? A. We agreed on the deadline. Be sure, I will take a look. See let me show you. Number 15';
  const item = { ...answer('Which folder are the documents in?', 'let me show you.'), part: 2,
    responses: ['We agreed on the deadline.', 'sure, I will take a look.', 'let me show you.'] };
  const prefix = transcript.slice(0, transcript.indexOf(' Number 15'));
  assert.equal(validateListeningResult({ consumed_text: prefix.replace('14 Which', '14. Which'), answers: [item] }, transcript).consumed_text, prefix);
  assert.deepEqual(validateListeningResult({ consumed_text: prefix, answers: [{ ...item, responses: item.responses.slice(0, 2) }] }, transcript).answers, []);
  assert.deepEqual(validateListeningResult({ consumed_text: prefix, answers: [{ ...item, responses: ['We agreed on the deadline.', 'sure, I will take a look.', 'A made-up response.'] }] }, transcript).answers, []);
  assert.throws(() => validateListeningResult({ consumed_text: prefix.replace('folder', 'building'), answers: [item] }, transcript));
  const mixed = prefix + ' Number 15. A made-up response.';
  assert.deepEqual(validateListeningResult({ consumed_text: mixed, answers: [{ ...item, question_number: 14,
    responses: ['We agreed on the deadline.', 'sure, I will take a look.', 'A made-up response.'] }] }, mixed).answers, []);
});
