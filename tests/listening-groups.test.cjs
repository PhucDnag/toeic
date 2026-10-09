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
