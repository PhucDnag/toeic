const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, overrides = {}) {
  const filename = path.resolve(__dirname, '../src', file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const localRequire = name => {
    if (name in overrides) return overrides[name];
    if (name.startsWith('@/')) return load(`${name.slice(2)}.ts`, overrides);
    if (name.startsWith('.')) return load(path.relative(path.resolve(__dirname, '../src'), path.resolve(path.dirname(filename), `${name}.ts`)), overrides);
    return require(name);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports;
}

const { TOEICStateMachine } = load('lib/state-machine.ts');
function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const machine = new TOEICStateMachine();
  const calls = [];
  machine.setSolveCallback(async q => {
    calls.push(structuredClone(q));
    return { questionNumber: q.questionNumber, answer: q.part === 2 ? 'A' : null,
      answerText: 'At the station.', confidence: 0.9, reason: 'Evidence', translation: 'Bằng chứng', vocabulary: [] };
  });
  machine.start();
  return { machine, calls };
}
async function settle(t) {
  t.mock.timers.tick(200);
  await new Promise(resolve => setImmediate(resolve));
}

test('all Part 3/4 groups retain a separate full passage and solve three questions without choices', async t => {
  const { machine, calls } = setup(t);
  for (let first = 32; first <= 98; first += 3) {
    const passage = `We are at station ${first}. ` + 'Please keep your tickets ready. '.repeat(120);
    machine.processTranscript(`Questions ${first} through ${first + 2} refer to the following conversation. ${passage}`);
    assert.equal(calls.length, first - 32);
    machine.processTranscript(`Number ${first}. Where are the speakers? Number ${first + 1}. What should passengers keep ready? Number ${first + 2}. What are the listeners asked to do?`);
    for (let i = 0; i < 3; i++) {
      await settle(t);
      const q = calls.at(-1);
      assert.equal(q.questionNumber, first + i);
      assert.equal(q.passage, passage.trim());
      assert.deepEqual(q.choices, {});
      assert.ok(!q.questionText.includes('Number'));
      t.mock.timers.tick(2500);
    }
  }
  assert.equal(calls.length, 69);
  assert.equal(machine.getContext().history.length, 69);
  assert.equal(machine.getContext().history[0].answer, null);
  assert.equal(machine.getContext().history[0].answerText, 'At the station.');
  machine.stop();
});

test('split question is joined and transcript received during solving is replayed', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('Questions seventy-one through seventy-three refer to the following announcement. The museum opens at nine.');
  machine.processTranscript('Number seventy-one. When does');
  assert.equal(calls.length, 0);
  machine.processTranscript('the museum open?');
  machine.processTranscript('Number seventy-two. What place is mentioned? Number seventy-three. Who is speaking?');
  for (let i = 0; i < 3; i++) { await settle(t); t.mock.timers.tick(2500); }
  assert.deepEqual(calls.map(q => q.questionNumber), [71, 72, 73]);
  assert.equal(calls[0].questionText, 'When does the museum open?');
  assert.ok(calls.every(q => q.passage === 'The museum opens at nine.'));
  machine.stop();
});

test('question without punctuation finishes on pause and next group does not inherit old passage', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('Questions 71 through 73 refer to the following talk. The train is delayed. Number 71. What is delayed');
  t.mock.timers.tick(2500); await settle(t);
  assert.equal(calls[0].questionText, 'What is delayed');
  machine.processTranscript('Questions 74 through 76 refer to the following message. Your order is ready. Number 74. What is ready?');
  t.mock.timers.tick(2500); await settle(t);
  assert.equal(calls[1].passage, 'Your order is ready.');
  machine.stop();
});

test('Part 2 still collects A/B/C and chooses a letter', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('Number 7. I cannot find the stapler. A. Karen might have it. B. Why cannot she stay? C. I am sorry you cannot come.');
  await settle(t);
  assert.equal(calls[0].part, 2);
  assert.equal(calls[0].choices.A, 'Karen might have it.');
  assert.equal(machine.getContext().currentAnswer.answer, 'A');
  machine.stop();
});

test('continuous Part 2 solves all 25 questions even when audio arrives while solving', async t => {
  const { machine, calls } = setup(t);
  const question = n => `Number ${n}. Where is office ${n}? A. On floor ${n}. B. Tomorrow morning. C. No thanks.`;
  machine.processTranscript(question(7));
  machine.processTranscript(Array.from({ length: 24 }, (_, i) => question(i + 8)).join(' '));
  for (let n = 7; n <= 31; n++) {
    await settle(t);
    assert.equal(calls.at(-1).questionNumber, n);
    assert.equal(calls.at(-1).choices.A, `On floor ${n}.`);
    assert.equal(calls.at(-1).choices.C, 'No thanks.');
    t.mock.timers.tick(2500);
  }
  assert.equal(calls.length, 25);
  machine.stop();
});

test('25 questions retain late choices and split C answers despite slow transcription', async t => {
  const { machine, calls } = setup(t);
  for (let n = 7; n <= 31; n++) {
    machine.setTranscriptionPending(true);
    machine.processTranscript(`Number ${n}. Where is office ${n}? A. Upstairs.`);
    t.mock.timers.tick(20000);
    await settle(t);
    assert.equal(calls.length, n - 7, 'network delay must not solve a partial question');
    machine.processTranscript('B. Tomorrow. C. Ask Jane.');
    await settle(t);
    assert.equal(calls.length, n - 7, 'punctuation from Whisper may precede more answer text');
    machine.processTranscript('She knows the building.');
    machine.setTranscriptionPending(false);
    t.mock.timers.tick(1200);
    await settle(t);
    assert.equal(calls.at(-1).choices.C, 'Ask Jane. She knows the building.');
    assert.equal(calls.at(-1).questionNumber, n);
    t.mock.timers.tick(2500);
  }
  assert.equal(machine.getContext().history.length, 25);
  machine.stop();
});

test('a gap between choice uploads never auto-solves missing B/C', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('Number 7. Where is it? A. Upstairs.');
  t.mock.timers.tick(30000);
  await settle(t);
  assert.equal(calls.length, 0);
  machine.processTranscript('B. Tomorrow. C. At reception.');
  await settle(t);
  assert.equal(calls[0].choices.C, 'At reception.');
  machine.stop();
});

test('numeric noise from the screenshot never locks question detection', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('Number 9. Would you like help? A. Knives and forks. B. I can manage it alone, thanks. C. No thanks.');
  await settle(t);
  machine.processTranscript('C. N. N. 2. 3. 2. In the Daily Newspaper. B. 3. 2. 3. 2. 2. 2. 2.');
  t.mock.timers.tick(2500);
  assert.equal(machine.getContext().currentQuestion, null);
  machine.processTranscript("Number 10. There aren't enough seats for everyone. A. I'm not sure. B. It was very comfortable. C. I'll get some extra chairs.");
  await settle(t);
  assert.deepEqual(calls.map(q => q.questionNumber), [9, 10]);
  assert.equal(calls[1].choices.C, "I'll get some extra chairs.");
  machine.stop();
});

test('an empty numbered question is skipped when the next valid question arrives', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('Number 10.');
  machine.processTranscript('Number eleven. When is lunch? A. At noon. B. Over there. C. No thanks.');
  await settle(t);
  assert.deepEqual(calls.map(q => q.questionNumber), [11]);
  assert.equal(machine.getContext().history[0].questionNumber, 10);
  assert.equal(machine.getContext().history[0].answer, undefined);
  machine.stop();
});

test('choice continuation updates even when the number of choices has not changed', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('Number twelve. Where is the meeting? A. Upstairs. B. On');
  machine.processTranscript('Monday morning.');
  assert.equal(machine.getContext().currentQuestion.choices.B, 'On Monday morning.');
  machine.processTranscript('C. At the reception desk.');
  await settle(t);
  assert.equal(calls[0].choices.B, 'On Monday morning.');
  machine.stop();
});

test('Part 2 to Part 3 transition preserves the next passage in the same chunk', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('Number 31. Is the office open? A. Yes it is. B. Tomorrow. C. At noon. Questions 32 through 34 refer to the following conversation. Welcome to the clinic. Number 32. Where are the speakers?');
  await settle(t); t.mock.timers.tick(2500); await settle(t);
  assert.deepEqual(calls.map(q => q.questionNumber), [31, 32]);
  assert.equal(calls[1].passage, 'Welcome to the clinic.');
  machine.stop();
});

test('a hung solver times out and questions heard during error recovery are retained', async t => {
  const { machine, calls } = setup(t);
  machine.setSolveCallback(q => {
    calls.push(q);
    if (q.questionNumber === 7) return new Promise(() => {});
    return Promise.resolve({ questionNumber: q.questionNumber, answer: 'A', confidence: 0.9 });
  });
  const question = n => `Number ${n}. Is it ready? A. Yes it is. B. Yesterday. C. Over there.`;
  machine.processTranscript(question(7));
  await settle(t);
  machine.processTranscript(question(8));
  t.mock.timers.tick(30000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(machine.getContext().appState, 'ERROR');
  machine.processTranscript(question(9));
  t.mock.timers.tick(3000); await settle(t);
  t.mock.timers.tick(2500); await settle(t);
  assert.deepEqual(calls.map(q => q.questionNumber), [7, 8, 9]);
  machine.stop();
});

test('solve route asks for content and never returns a fabricated letter for Part 3/4', async () => {
  const captured = [];
  class FakeOpenAI {
    chat = { completions: { create: async body => {
      captured.push(body);
      return { choices: [{ message: { content: JSON.stringify({ answer: 'D', answer_text: 'At the station.', confidence: 0.9 }) } }] };
    } } };
  }
  const route = load('app/api/solve/route.ts', {
    openai: FakeOpenAI,
    '@/lib/server/groq-key-pool': { getGroqApiKeys: () => ['test'], withGroqKeyFailover: fn => fn('test'), isGroqKeyUnavailableError: () => false },
  });
  for (const number of [32, 71, 100]) {
    const result = await route.POST(new Request('http://localhost/api/solve', { method: 'POST', body: JSON.stringify({ question_number: number, question: 'Where are the speakers?', passage: 'We are at the station.' }) }));
    assert.equal(result.status, 200);
    const body = await result.json();
    assert.equal(body.answer, null);
    assert.equal(body.answer_text, 'At the station.');
    assert.ok(captured.at(-1).messages[1].content.includes('No answer choices are available'));
    assert.ok(!captured.at(-1).messages[1].content.includes('A. (not provided)'));
  }
});

test('transcription route exposes pool cooldown as 429 with Retry-After', async t => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  class PoolExhausted extends Error { retryAfterMs = 30500; }
  const route = load('app/api/transcribe/route.ts', {
    '@/lib/server/groq-key-pool': {
      getGroqApiKeys: () => ['test'], GroqKeyPoolExhaustedError: PoolExhausted,
      withGroqKeyFailover: async () => { throw new PoolExhausted('cooldown'); },
    },
  });
  const form = new FormData();
  form.append('file', new Blob(['audio']), 'audio.wav');
  const response = await route.POST(new Request('http://localhost/api/transcribe', { method: 'POST', body: form }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '31');
});

test('raw solve route bypasses choice formatting and returns answer content with a safe boundary', async () => {
  const text = 'What dinner specials do you have today? We have baked salmon. For the first time. No I have not.';
  let malformed = false;
  const captured = [];
  class FakeOpenAI {
    chat = { completions: { create: async body => {
      captured.push(body);
      return { choices: [{ message: { content: JSON.stringify({
        consumed_text: malformed ? 'made up boundary' : text,
        answers: [{ part: 2, responses: ['We have baked salmon.', 'For the first time.', 'No I have not.'], question_number: null, question: 'What dinner specials do you have today?',
          answer_text: 'We have baked salmon.', confidence: 0.9, reason: 'It names the special.', translation: 'Đây là món đặc biệt.' }],
      }) } }] };
    } } };
  }
  const route = load('app/api/solve/route.ts', {
    openai: FakeOpenAI,
    '@/lib/server/groq-key-pool': { getGroqApiKeys: () => ['test'], withGroqKeyFailover: fn => fn('test'), isGroqKeyUnavailableError: () => false },
  });
  const request = () => new Request('http://localhost/api/solve', { method: 'POST', body: JSON.stringify({ mode: 'raw', transcript: text }) });
  const response = await route.POST(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).answers[0].answer_text, 'We have baked salmon.');
  assert.ok(!captured[0].messages[1].content.includes('(not provided)'));
  assert.ok(captured[0].messages[0].content.includes('Leave incomplete trailing speech unconsumed'));
  malformed = true;
  assert.equal((await route.POST(request())).status, 500);
});

test('Groq-only solver tries the next key, then the next model, and returns cooldown when all are limited', async t => {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^GROQ_API_KEY/.test(name)) delete env[name];
  env.GROQ_API_KEYS = 'first,second';
  t.mock.property(process, 'env', env);
  const pool = load('lib/server/groq-key-pool.ts', { 'server-only': {} });
  const calls = [];
  let limitAll = false;
  class FakeGroq {
    constructor(options) {
      assert.equal(options.baseURL, 'https://api.groq.com/openai/v1');
      this.chat = { completions: { create: async body => {
        calls.push([body.model, options.apiKey]);
        if (limitAll || body.model === 'openai/gpt-oss-120b') throw { status: 429, headers: new Headers({ 'retry-after': '10' }) };
        return { choices: [{ message: { content: JSON.stringify({ answer: 'A', answer_text: 'At noon.' }) } }] };
      } } };
    }
  }
  const route = load('app/api/solve/route.ts', { openai: FakeGroq, '@/lib/server/groq-key-pool': pool });
  const request = () => new Request('http://localhost/api/solve', { method: 'POST', body: JSON.stringify({ part: 2, question_number: 7, question: 'When is lunch?' }) });
  assert.equal((await route.POST(request())).status, 200);
  assert.deepEqual(calls.slice(0, 3), [
    ['openai/gpt-oss-120b', 'first'], ['openai/gpt-oss-120b', 'second'], ['openai/gpt-oss-20b', 'first'],
  ]);
  limitAll = true;
  const response = await route.POST(request());
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('Retry-After')) > 0);
  const count = calls.length;
  assert.equal((await route.POST(request())).status, 429);
  assert.equal(calls.length, count, 'cooling keys must not be retried early');
});
