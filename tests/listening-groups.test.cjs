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
      const q = calls[first - 32 + i];
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

test('screenshot transcript solves 7, 8 and 9 despite Numer and N umer headers', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('I hear a question. Number 7. What type of food does that store sell? A. What a delicious recipe. B. They have all kinds of cheese. C. With a new jacket. P. I have a question.');
  await settle(t);
  machine.processTranscript("Numer 8. When should we leave for the airport? A. This afternoon at 10 o'clock. B. I prefer to stay at the airport. C. I prefer an aisle seat. D. Mr. Choi travelled there last year. A. I prefer to stay at the airport. N umer 9. Where's the hiring event being held? A. She sent it to a colleague. B. In the main conference room. C. If they open on time, I'll be there. A. Open on time?");
  for (let i = 0; i < 3; i++) { t.mock.timers.tick(2500); await settle(t); }
  assert.deepEqual(calls.map(q => q.questionNumber), [7, 8, 9]);
  assert.equal(calls[1].choices.A, "This afternoon at 10 o'clock.");
  assert.equal(calls[2].choices.B, 'In the main conference room.');
  machine.stop();
});

test('a repeated number does not cut off choices or let repeated labels overwrite them', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('Number 11. Why is the building being renovated? Number 11. Why is the building being renovated? A. When we arrange the building? B. With the new designs. C. Because new sales figures came in. A. When we arrange the building? C. When we arrange the building? Number 12. Who ordered these vegetables? A. All of it. B. I believe Luis did. C. It was excellent.');
  for (let i = 0; i < 2; i++) { await settle(t); t.mock.timers.tick(2500); }
  assert.deepEqual(calls.map(q => q.questionNumber), [11, 12]);
  assert.equal(calls[0].questionText, 'Why is the building being renovated?');
  assert.equal(calls[0].choices.C, 'Because new sales figures came in.');
  machine.stop();
});

test('real Whisper chunk overlap Number 7 then 7 retains the prompt and all choices', async t => {
  const { machine, calls } = setup(t);
  for (const text of ['Number 7.', '7. What type of food does that store sell?',
    'A. What a delicious recipe.', 'B. They have all kinds of cheese.', 'C. With a new jacket.', 'Jacket.']) {
    machine.processTranscript(text);
  }
  await settle(t);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].questionText, 'What type of food does that store sell?');
  assert.deepEqual(calls[0].choices, { A: 'What a delicious recipe.', B: 'They have all kinds of cheese.', C: 'With a new jacket.' });
  machine.stop();
});

test('a fresh listening session can replay earlier question numbers', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('Number 12. Who ordered these vegetables? A. All of it. B. I believe Luis did. C. It was excellent.');
  await settle(t);
  machine.stop(); machine.start();
  machine.processTranscript('Number 7. What type of food does that store sell? A. What a delicious recipe. B. They have all kinds of cheese. C. With a new jacket.');
  await settle(t);
  assert.deepEqual(calls.map(q => q.questionNumber), [12, 7]);
  machine.stop();
});

test('queued questions start solving immediately after the preceding answer', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('Number 7. Is it ready? A. Yes it is. B. Yesterday. C. Over there. Number 8. Who is coming? A. The manager. B. Tomorrow. C. No thanks.');
  await settle(t);
  await settle(t);
  assert.deepEqual(calls.map(q => q.questionNumber), [7, 8], 'answer display must not hold the queue for 2.5 seconds');
  machine.stop();
});

test('partial questions wait for missing responses without spending AI calls on repeated noise', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript('Numer 13. How often should I mail the notices? A. Once a month. B. After three o\'clock.');
  for (let i = 0; i < 7; i++) {
    t.mock.timers.tick(1000);
    machine.processTranscript("A. Once a month. B. After three o'clock.");
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(calls.length, 0);
  assert.equal(machine.getContext().appState, 'WAITING_FOR_CHOICES');
  machine.forceSolve();
  assert.equal(calls.length, 0, 'manual solving must not fill unheard choices with placeholders');
  machine.processTranscript('C. About half of them.');
  await settle(t);
  assert.deepEqual(calls.map(q => q.questionNumber), [13]);
  machine.stop();
});

test('screenshot 13 through 16 preserves each question despite repeats and empty repeated headers', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript("Number 13. How often should I mail the notices? A. Once a month. B. After 3 o'clock.");
  machine.processTranscript("C. About half of them. N. P. I don't know. A. I don't know. B. I don't know. N. Number 14. Which folder are the documents in? A. We agreed on the deadline for the next meeting. B. Sure. I'll take a look. C. Let me show you. N. Number 14. N. Number 15. Did you end up going to a movie? Or to the concert last night? A. I saw that action film. B. It just ended. C. Just a couple of my friends. A. I saw that action film. C. I saw that action film. N. Number 16. We'll take the company bus to the conference center. A. I'm sure it's not. B. Maybe we did. C. That's a good plan. C. Tl n.");
  await settle(t);
  assert.deepEqual(calls.map(q => q.questionNumber), [13, 14, 15, 16]);
  assert.equal(calls[1].choices.C, 'Let me show you. N.');
  assert.equal(calls[2].choices.C, 'Just a couple of my friends.');
  assert.equal(calls[3].choices.C, "That's a good plan.");
  machine.stop();
});

test('continuous Part 2 solves all 25 questions even when audio arrives while solving', async t => {
  const { machine, calls } = setup(t);
  const cleanups = [];
  machine.setTranscriptCleanupCallback(text => cleanups.push(text));
  const question = n => `Number ${n}. Where is office ${n}? A. On floor ${n}. B. Tomorrow morning. C. No thanks.`;
  machine.processTranscript(question(7));
  machine.processTranscript(Array.from({ length: 24 }, (_, i) => question(i + 8)).join(' '));
  for (let n = 7; n <= 31; n++) {
    await settle(t);
    assert.equal(calls[n - 7].questionNumber, n);
    assert.equal(calls[n - 7].choices.A, `On floor ${n}.`);
    assert.equal(calls[n - 7].choices.C, 'No thanks.');
    t.mock.timers.tick(2500);
  }
  assert.equal(calls.length, 25);
  assert.equal(cleanups.length, 8, 'clear after every three completed questions');
  assert.ok(cleanups.every(text => text.length <= 2400));
  assert.ok(calls.every(question => question.passage === ''), 'Part 2 must not carry old questions to AI');
  assert.equal(machine.getContext().history.length, 25, 'cleanup must preserve all answers');
  machine.stop();
});

test('cleanup preserves a split next question and does not replay completed questions', async t => {
  const { machine, calls } = setup(t);
  const cleanups = [];
  machine.setTranscriptCleanupCallback(text => cleanups.push(text));
  const question = n => `Number ${n}. Is it ready? A. Yes it is. B. Yesterday. C. Over there.`;
  machine.processTranscript([question(7), question(8), question(9), 'Number 10. Where is'].join(' '));
  await settle(t);
  assert.deepEqual(cleanups, ['Number 10. Where is']);
  assert.equal(machine.getContext().currentQuestion.questionNumber, 10);
  machine.processTranscript('the meeting? A. Upstairs. B. Tomorrow. C. Yes please.');
  await settle(t);
  assert.deepEqual(calls.map(q => q.questionNumber), [7, 8, 9, 10]);
  assert.equal(calls[3].questionText, 'Where is the meeting?');
  machine.processTranscript(question(7));
  await settle(t);
  assert.equal(calls.length, 4);
  machine.stop();
});

test('cleanup in the middle of a Part 3 group keeps the entire active passage', async t => {
  const { machine, calls } = setup(t);
  const cleanups = [];
  machine.setTranscriptCleanupCallback(text => cleanups.push(text));
  machine.processTranscript('Number 30. Is it ready? A. Yes. B. Tomorrow. C. Over there. Number 31. Who called? A. Jim. B. Tomorrow. C. At noon.');
  await settle(t);
  machine.processTranscript('Questions 32 through 34 refer to the following conversation. The train leaves at nine. Number 32. What leaves at nine? Number 33. When does');
  await settle(t);
  assert.equal(cleanups.length, 1);
  machine.processTranscript('the train leave? Number 34. What transport is mentioned?');
  await settle(t);
  assert.deepEqual(calls.map(q => q.questionNumber), [30, 31, 32, 33, 34]);
  assert.ok(calls.slice(2).every(q => q.passage === 'The train leaves at nine.'));
  machine.stop();
});

test('incomplete question at a new boundary is recorded without calling AI or blocking the next one', async t => {
  const { machine, calls } = setup(t);
  machine.processTranscript("Numer 18. I've got a few things to show you. A. I've got a few things to show you. Number 19. Who is coming? A. The manager. B. Tomorrow. C. No thanks.");
  await settle(t);
  assert.deepEqual(calls.map(q => q.questionNumber), [19]);
  assert.equal(machine.getContext().history[0].answer, undefined);
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
    '@/lib/server/groq-key-pool': { getGroqApiKeys: () => ['test'], withGroqKeyFailover: fn => fn('test'), getErrorStatus: error => error?.status, isGroqKeyUnavailableError: () => false },
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

test('answer-only API excludes old transcripts and returns only the chosen response', async () => {
  const captured = [];
  class FakeOpenAI {
    chat = { completions: { create: async body => {
      captured.push(body);
      return { choices: [{ message: { content: JSON.stringify({ answer: 'b', question_number: 99, reason: 'unneeded', vocabulary: ['unneeded'] }) } }] };
    } } };
  }
  const route = load('app/api/solve/route.ts', {
    openai: FakeOpenAI,
    '@/lib/server/groq-key-pool': { getGroqApiKeys: () => ['test'], withGroqKeyFailover: fn => fn('test'), getErrorStatus: error => error?.status, isGroqKeyUnavailableError: () => false },
  });
  const result = await route.POST(new Request('http://localhost/api/solve', { method: 'POST', body: JSON.stringify({
    part: 2, question_number: 7, question: 'Who ordered these vegetables?',
    choices: { A: 'All of it.', B: 'I believe Luis did.', C: 'It was excellent.' },
    passage: 'OLD TRANSCRIPT '.repeat(200),
  }) }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { question_number: 7, answer: 'B', answer_text: 'I believe Luis did.' });
  assert.ok(!captured[0].messages[1].content.includes('OLD TRANSCRIPT'));
  assert.ok(captured[0].max_tokens <= 96);
});

test('answer-only API never fabricates A for incomplete input or invalid model output', async () => {
  let requests = 0;
  class FakeOpenAI {
    chat = { completions: { create: async () => {
      requests++;
      return { choices: [{ message: { content: '{}' } }] };
    } } };
  }
  const route = load('app/api/solve/route.ts', {
    openai: FakeOpenAI,
    '@/lib/server/groq-key-pool': { getGroqApiKeys: () => ['test'], withGroqKeyFailover: fn => fn('test'), getErrorStatus: error => error?.status, isGroqKeyUnavailableError: () => false },
  });
  const request = choices => new Request('http://localhost/api/solve', { method: 'POST', body: JSON.stringify({
    part: 2, question_number: 18, question: "I've got a few things to show you.", choices,
  }) });
  assert.equal((await route.POST(request({ A: 'Some things.' }))).status, 422);
  assert.equal(requests, 0);
  const result = await route.POST(request({ A: 'Some things.', B: 'Tomorrow.', C: 'Yes please.' }));
  assert.equal(result.status, 502);
  assert.equal((await result.json()).answer, undefined);
});

test('a missing Groq model falls back and is skipped on the next question', async () => {
  const attempts = [];
  class FakeOpenAI {
    chat = { completions: { create: async body => {
      attempts.push(body);
      if (body.model === 'qwen/qwen3.8-27b') throw Object.assign(new Error('model_not_found'), { status: 404 });
      return { choices: [{ finish_reason: 'stop', message: { content: '{"answer":"B"}' } }] };
    } } };
  }
  const route = load('app/api/solve/route.ts', {
    openai: FakeOpenAI,
    '@/lib/server/groq-key-pool': {
      getGroqApiKeys: () => ['test'], getErrorStatus: error => error?.status,
      withGroqKeyFailover: fn => fn('test'), isGroqKeyUnavailableError: () => false,
    },
  });
  for (const number of [7, 8]) {
    const result = await route.POST(new Request('http://localhost/api/solve', { method: 'POST', body: JSON.stringify({
      part: 2, question_number: number, question: 'Who ordered the vegetables?',
      choices: { A: 'All of it.', B: 'Luis did.', C: 'It was excellent.' },
    }) }));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).answer, 'B');
  }
  assert.deepEqual(attempts.map(body => body.model), ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'openai/gpt-oss-20b']);
  assert.equal(attempts[0].reasoning_effort, 'none');
  assert.equal(attempts[1].reasoning_effort, 'low');
  assert.equal(attempts[1].include_reasoning, false);
  assert.ok(attempts[1].max_tokens >= 512, 'reasoning budget must not cut off the final answer');
});

test('truncated output is retried on the next model instead of returning a broken answer', async () => {
  const attempts = [];
  class FakeOpenAI {
    chat = { completions: { create: async body => {
      attempts.push(body.model);
      return { choices: [{ finish_reason: attempts.length === 1 ? 'length' : 'stop',
        message: { content: attempts.length === 1 ? '{"answer":' : '{"answer":"B"}' } }] };
    } } };
  }
  const route = load('app/api/solve/route.ts', {
    openai: FakeOpenAI,
    '@/lib/server/groq-key-pool': {
      getGroqApiKeys: () => ['test'], getErrorStatus: error => error?.status,
      withGroqKeyFailover: fn => fn('test'), isGroqKeyUnavailableError: () => false,
    },
  });
  const result = await route.POST(new Request('http://localhost/api/solve', { method: 'POST', body: JSON.stringify({
    part: 2, question_number: 7, question: 'Who ordered the vegetables?', choices: { A: 'All.', B: 'Luis.', C: 'Excellent.' },
  }) }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).answer, 'B');
  assert.equal(attempts.length, 2);
});

test('transcription ignores old predicted context, preventing a repeated phrase feedback loop', async () => {
  let prompt;
  class FakeOpenAI {
    static toFile = async buffer => buffer;
    audio = { transcriptions: { create: async body => {
      prompt = body.prompt;
      return { text: 'Number 19.', segments: [{ text: 'Number 19.', no_speech_prob: 0, avg_logprob: 0, compression_ratio: 1 }] };
    } } };
  }
  const route = load('app/api/transcribe/route.ts', {
    openai: FakeOpenAI,
    '@/lib/server/groq-key-pool': { getGroqApiKeys: () => ['test'], withGroqKeyFailover: fn => fn('test') },
  });
  const form = new FormData();
  form.append('file', new Blob(['test audio'], { type: 'audio/wav' }), 'audio.wav');
  form.append('context', "I've got a few things to show you. ".repeat(50));
  const result = await route.POST(new Request('http://localhost/api/transcribe', { method: 'POST', body: form }));
  assert.equal(result.status, 200);
  assert.equal(prompt, undefined, 'do not seed hallucinated A/B/C/D or past predictions');
});
