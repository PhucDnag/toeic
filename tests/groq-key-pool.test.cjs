const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(__dirname, '../src/lib/server/groq-key-pool.ts'),
  'utf8'
);

function loadPool() {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function('exports', 'module', 'require', compiled)(
    loaded.exports,
    loaded,
    (name) => (name === 'server-only' ? {} : require(name))
  );
  return loaded.exports;
}

function configure(keys) {
  for (const name of Object.keys(process.env)) {
    if (/^GROQ_API_KEY(?:S|_\d+)?$/.test(name)) delete process.env[name];
  }
  Object.assign(process.env, keys);
}

test('reads and deduplicates single, list, and numbered Groq keys', () => {
  configure({
    GROQ_API_KEY: 'primary',
    GROQ_API_KEYS: 'second, third;primary',
    GROQ_API_KEY_2: 'fifth',
    GROQ_API_KEY_1: 'fourth',
  });
  const pool = loadPool();
  assert.deepEqual(pool.getGroqApiKeys(), [
    'primary', 'second', 'third', 'fourth', 'fifth',
  ]);
});

test('switches to the next key after a rate-limit response', async () => {
  configure({ GROQ_API_KEYS: 'first,second,third' });
  const pool = loadPool();
  const attempted = [];
  const selected = await pool.withGroqKeyFailover(async (apiKey) => {
    attempted.push(apiKey);
    if (apiKey === 'first') throw { status: 429 };
    return apiKey;
  });
  assert.equal(selected, 'second');
  assert.deepEqual(attempted, ['first', 'second']);
});

test('does not rotate keys for a request error unrelated to quota or credentials', async () => {
  configure({ GROQ_API_KEYS: 'first,second' });
  const pool = loadPool();
  const attempted = [];
  await assert.rejects(
    pool.withGroqKeyFailover(async (apiKey) => {
      attempted.push(apiKey);
      const error = new Error('Invalid audio file');
      error.status = 400;
      throw error;
    }),
    /Invalid audio file/
  );
  assert.deepEqual(attempted, ['first']);
});

test('exhausted pool reports the earliest cooldown so audio can wait instead of being discarded', async t => {
  t.mock.method(Date, 'now', () => 100000);
  configure({ GROQ_API_KEYS: 'first,second' });
  const pool = loadPool();
  await assert.rejects(pool.withGroqKeyFailover(async key => {
    throw { status: 429, headers: new Headers({ 'retry-after': key === 'first' ? '30' : '60' }) };
  }), error => error.retryAfterMs === 30000);
  await assert.rejects(pool.withGroqKeyFailover(() => assert.fail('must respect cooldown')),
    error => error.retryAfterMs === 30000);
});

test('chat rate limits do not disable Whisper or a different chat model', async () => {
  configure({ GROQ_API_KEY: 'first' });
  const pool = loadPool();
  await assert.rejects(pool.withGroqKeyFailover(async () => { throw { status: 429 }; }, 'chat-a'));
  assert.equal(await pool.withGroqKeyFailover(async key => key, 'whisper-large-v3'), 'first');
  assert.equal(await pool.withGroqKeyFailover(async key => key, 'chat-b'), 'first');
  await assert.rejects(pool.withGroqKeyFailover(() => assert.fail('cooling key must not be called'), 'chat-a'));
});

test('invalid credentials are excluded across models', async () => {
  configure({ GROQ_API_KEYS: 'bad,good' });
  const pool = loadPool();
  await pool.withGroqKeyFailover(async key => { if (key === 'bad') throw { status: 401 }; return key; }, 'chat');
  const attempted = [];
  await pool.withGroqKeyFailover(async key => attempted.push(key), 'whisper');
  assert.deepEqual(attempted, ['good']);
});

test('keys rotate, recover after cooldown, and late successes do not erase a limit', async t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  configure({ GROQ_API_KEYS: 'first,second' });
  const pool = loadPool();
  const keys = [];
  for (let i = 0; i < 4; i++) keys.push(await pool.withGroqKeyFailover(async key => key));
  assert.deepEqual(keys, ['first', 'second', 'first', 'second']);
  configure({ GROQ_API_KEY: 'only' });
  let finish;
  const slow = pool.withGroqKeyFailover(() => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(pool.withGroqKeyFailover(async () => { throw { status: 429, headers: { 'retry-after': '10' } }; }));
  finish('success'); await slow;
  await assert.rejects(pool.withGroqKeyFailover(() => assert.fail('late success cleared cooldown')));
  now += 10000;
  assert.equal(await pool.withGroqKeyFailover(async key => key), 'only');
});
