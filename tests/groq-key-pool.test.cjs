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
